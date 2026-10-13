/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { cleanupFailedAdoption } from '../fromConfig-cleanup.js';
import { fromConfig } from '../fromConfig.js';
import {
  buildFactoryLessConfig,
  buildTestMcpRuntime,
} from './helpers/buildCliStyleConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('adoption cleanup with explicit close operations', () => {
  const credentials = useOwnedCredentials();
  it('joins client closure before runtime closure and preserves independent failures', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'adoption-cleanup-')),
    );
    const fixture = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      {
        workingDir: directory,
        sessionId: 'cleanup-caller',
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
      },
    );
    const { config, settingsService, settingsOwner, messageBus, policyOwner } =
      fixture;
    const mcp = await buildTestMcpRuntime(
      config,
      messageBus,
      {},
      undefined,
      policyOwner,
    );
    const files = new ProviderFileLifecycle({ maxFiles: 10, maxBytes: 1024 });
    const agent = await fromConfig({
      ...fixture,
      mcpRuntime: mcp,
      providerFileLifecycle: files,
      credentialAuthority: credentials().authority,
    });
    const { tokenizerFactory, contentGeneratorFactory } =
      configureProviderRuntimeFactories(config, agent.providerManager);
    const media = new SessionMediaOwner(config.projectTempDir, 1024);
    const owner = await SessionClientOwner.create(
      config,
      assembleTaskSchemaPolicy(settingsService),
      agent.providerManager,
      buildAgentClientFactory(),
      media.store,
      mcp.readInstructions,
      mcp.workspacePaths,
      settingsOwner,
      contentGeneratorFactory,
      tokenizerFactory,
    );
    const file = join(directory, 'missing-remote-file');
    await writeFile(file, 'remote upload');
    const retained = await files.retain({
      cacheKey: file,
      fileId: 'cleanup-upload',
      bytes: 13,
      identity: {
        provider: 'fake',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'cleanup',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60_000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      scopeId: config.getSessionId(),
      deleteRemote: () => rm(file),
    });
    await retained.lease.release();
    await rm(file);
    let signalEntered = (): void => {};
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve;
    });
    let signalRelease = (): void => {};
    const release = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
    const primary = new Error('adoption failed');
    let runtimeFailure: unknown;
    let settled = false;
    const result = cleanupFailedAdoption(
      primary,
      async () => {
        signalEntered();
        await release;
        try {
          await agent.dispose();
        } catch (error) {
          runtimeFailure = error;
          throw new AggregateError([primary, error]);
        }
      },
      undefined,
      () => media.dispose(),
      () => owner.dispose(),
    ).catch((error: unknown) => {
      settled = true;
      return error;
    });
    try {
      await entered;
      expect(settled).toBe(false);
      expect(() => owner.refreshAuth()).toThrow('disposed');
      signalRelease();
      const error = await result;
      if (!(error instanceof AggregateError))
        throw new Error('Expected joined cleanup failures');
      expect(error.errors).toStrictEqual([primary, runtimeFailure]);
      expect(runtimeFailure).toBeInstanceOf(Error);
      expect(error.errors[1]).toMatchObject({
        message: expect.stringContaining('cleanup-upload'),
      });
      expect(credentials().snapshot()).toStrictEqual([1]);
      await expect(media.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      signalRelease();
      await result;
      await mcp.dispose();
      await fixture.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
