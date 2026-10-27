/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import { runCleanupSteps } from '../../core/subagent-cleanup.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { fromConfig } from '../fromConfig.js';
import { cleanupFailedAdoption } from '../fromConfig-cleanup.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from './helpers/provider-acquisition.js';

import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { createCapturedSessionOwner } from './helpers/session-client-capture.js';

function mediaFailureConfig(directory: string): Config {
  return new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      telemetry: { enabled: false },
      recording: { enabled: false },
    }),
  );
}

describe('adoption cleanup with explicit close operations', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  it('retains agent workspace ownership when media acquisition fails before provider acquisition', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'adoption-media-rollback-')),
    );
    const config = mediaFailureConfig(directory);
    const settings = new SettingsService();
    const primary = new Error('media quota input failed');
    const quota = spyOn(
      config,
      'getMediaStoreQuotaByteLimit',
    ).mockImplementation(() => {
      throw primary;
    });
    try {
      await expect(
        fromConfig(config, settings, {}, credentials().authority),
      ).rejects.toBe(primary);
      settings.set('survived-media-failure', true);
      expect(settings.get('survived-media-failure')).toBe(true);
    } finally {
      quota.mockRestore();
      await runCleanupSteps([
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });

  it('releases an agent-owned workspace runtime when adoption cleanup runs', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'adoption-media-rollback-')),
    );
    const config = mediaFailureConfig(directory);
    const settings = new SettingsService();
    const selected = new SessionSettingsOwner(settings);
    const policy = new RuntimePolicyOwner(config);
    const mcp = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      {},
      undefined,
      policy,
    );
    const primary = new Error('media quota input failed');
    try {
      await expect(
        cleanupFailedAdoption(
          primary,
          () => undefined,
          () => mcp.dispose(),
          undefined,
          undefined,
        ),
      ).rejects.toBe(primary);
      expect(mcp.isStopped()).toBe(true);
      const retainsDirectory = await Promise.resolve()
        .then(() => mcp.workspacePaths.directories())
        .then(
          (directories) => directories.includes(directory),
          () => false,
        );
      expect(retainsDirectory).toBe(false);
      selected.writeUserParameter('survived-media-failure', true);
      expect(selected.readNamedParameter('survived-media-failure')).toBe(true);
    } finally {
      await runCleanupSteps([
        () => mcp.dispose(),
        () => selected.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });

  it('joins client closure before runtime closure and preserves independent failures', async () => {
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'adoption-cleanup-')),
    );
    const config = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        sessionId: 'cleanup-caller',
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
    );
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    const settingsOwner = new SessionSettingsOwner(settings);
    settingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    settingsOwner.bindTelemetry(config);
    const policy = new RuntimePolicyOwner(config);
    const mcp = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      {},
      undefined,
      policy,
    );
    const runtimeId = 'cleanup-' + randomUUID();
    const release = new AcquisitionRelease();
    release.acquire('settings', () => settingsOwner.dispose());
    const files = new ProviderFileLifecycle({ maxFiles: 10, maxBytes: 1024 });
    release.acquire('files', () =>
      releaseAdoptedFileScope(files, config.getSessionId()),
    );
    const manager = acquirePreferredProviderManager(
      config,
      settings,
      settingsOwner,
      files,
      runtimeId,
      credentials().authority,
      release,
    );
    acquirePreferredOAuth(
      undefined,
      mcp.messageBus,
      config,
      settings,
      manager,
      runtimeId,
      undefined,
      credentials().authority,
      release,
      null,
    );
    const media = new SessionMediaOwner(config.projectTempDir, 1024);
    const owner = await createCapturedSessionOwner(
      config,
      assembleTaskSchemaPolicy(settings),
      manager,
      buildAgentClientFactory(),
      media.store,
      mcp.readInstructions,
      mcp.workspacePaths,
      settingsOwner,
      createRuntimeContentGeneratorFactory(),
      configureProviderTokenizer(manager),
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
    const released = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
    const primary = new Error('adoption failed');
    let runtimeFailure: unknown;
    let joinedRuntimeFailure: AggregateError | undefined;
    let settled = false;
    const result = cleanupFailedAdoption(
      primary,
      async () => {
        signalEntered();
        await released;
        try {
          await release.close();
        } catch (error) {
          runtimeFailure = error;
          joinedRuntimeFailure = new AggregateError([primary, error]);
          throw joinedRuntimeFailure;
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
      expect(() => owner.clients.refreshAuth()).toThrow('disposed');
      signalRelease();
      const error = await result;
      if (!(error instanceof AggregateError))
        throw new Error('Expected joined cleanup failures');
      expect(error.errors).toStrictEqual([primary, joinedRuntimeFailure]);
      expect(joinedRuntimeFailure).toBeInstanceOf(AggregateError);
      expect(joinedRuntimeFailure?.errors).toStrictEqual([
        primary,
        runtimeFailure,
      ]);
      expect(runtimeFailure).toBeInstanceOf(Error);
      expect(joinedRuntimeFailure?.errors[1]).toMatchObject({
        message: expect.stringContaining('cleanup-upload'),
      });
      expect(credentials().snapshot()).toStrictEqual([1]);
      await expect(media.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
    } finally {
      signalRelease();
      await result;
      await runCleanupSteps([
        () => mcp.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);
    }
  });
});
