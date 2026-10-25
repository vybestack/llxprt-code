/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { realpath, rm } from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
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
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from '../preferred-provider-acquisition.js';
import { bindCreatedSessionClient } from '../policyComposition.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { makeScratchDir } from './helpers/scratch-dir.js';

describe('session policy binding rollback', () => {
  const credentials = useOwnedCredentials();

  it('rejects with the original binding failure when workspace binding fails after client acquisition', async () => {
    const authority = credentials().authority;
    const directory = await realpath(
      await makeScratchDir('policy-client-binding-rollback-'),
    );
    const config = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
    );
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    const policy = new RuntimePolicyOwner(config);
    const mcp = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      {},
      undefined,
      policy,
    );
    const runtimeId = 'policy-client-binding-' + randomUUID();
    const release = new AcquisitionRelease();
    const settingsOwner = new SessionSettingsOwner(settings);
    release.acquire('settings', () => settingsOwner.dispose());
    settingsOwner.initializeProviderSelection(
      config.getProvider(),
      config.getModel(),
    );
    settingsOwner.bindTelemetry(config);
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [runtimeId, config.getSessionId()])
      release.acquire('files', () => releaseAdoptedFileScope(files, scope));
    const manager = acquirePreferredProviderManager(
      config,
      settings,
      settingsOwner,
      files,
      runtimeId,
      authority,
      release,
    );
    const oauth = acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      config,
      settings,
      manager,
      runtimeId,
      mcp.profileDefinitions,
      authority,
      release,
      undefined,
    );
    const media = new SessionMediaOwner(config.projectTempDir, 1024 * 1024);
    const closeStack = (): Promise<void> =>
      runCleanupSteps([
        () => release.close(),
        () => media.dispose(),
        () => mcp.dispose(),
        () => policy.dispose(),
        () => config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ]);

    // A disposed workspace memory rejects the instruction subscription that
    // `bindMcpRuntime` makes after the client has been acquired.
    await mcp.workspaceMemory.dispose();
    try {
      const failure = await bindCreatedSessionClient(
        config,
        settings,
        settingsOwner,
        manager,
        oauth,
        createRuntimeContentGeneratorFactory(),
        configureProviderTokenizer(manager),
        files,
        media,
        mcp,
        false,
        undefined,
        authority,
      ).then(
        () => {
          throw new Error('Expected the policy binding to fail');
        },
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      if (!(failure instanceof Error)) throw failure;
      expect(failure).not.toBeInstanceOf(AggregateError);
      expect(failure.message).toBe('Workspace memory is disposed');
    } finally {
      await closeStack();
    }
  }, 30000);
});
