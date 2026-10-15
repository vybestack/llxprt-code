/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageBus } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { ProviderFileLifecycle, ProviderManager } from '../index.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from '../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../agents/src/core/subagent-cleanup.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import type { OAuthManager } from '../auth/oauth-manager.js';

import { PolicyEngine } from '@vybestack/llxprt-code-policy';
import {
  populateProviderManager,
  configureProviderRuntimeFactories,
  NodeFileSystem,
} from '../composition/index.js';

describe('provider manager runtime OAuth MessageBus composition', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let config: Config;
  let settings: SettingsService;
  let settingsOwner: SessionSettingsOwner;
  let manager: ProviderManager;
  let oauth: OAuthManager;
  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });
  async function openCaller(
    runtimeId: string,
    sessionId: string,
    model: string,
    suppliedBus: MessageBus | undefined = undefined,
  ): Promise<void> {
    try {
      const rawDirectory = await mkdtemp(join(tmpdir(), 'provider-bus-owner-'));
      retiring.push(() => rm(rawDirectory, { recursive: true, force: true }));
      const directory = await realpath(rawDirectory);
      const selectedConfig = new Config({
        sessionId,
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      config = selectedConfig;
      retiring.push(() => selectedConfig.dispose());
      const release = new AcquisitionRelease();
      let acquisitionComplete = false;
      retiring.push(() =>
        acquisitionComplete ? release.close() : release.rollback(),
      );
      settings = new SettingsService();
      const selectedSettingsOwner = new SessionSettingsOwner(settings);
      settingsOwner = selectedSettingsOwner;
      release.acquire('settings', () => selectedSettingsOwner.dispose());
      settingsOwner.initializeProviderSelection(
        config.getProvider(),
        config.getModel(),
      );
      settingsOwner.bindTelemetry(config);
      const policy = new RuntimePolicyOwner(config);
      release.acquire('policy', () => policy.dispose());
      const bus = suppliedBus ?? policy.session.messageBus;
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of new Set([runtimeId, sessionId]))
        release.acquire('files', () => releaseAdoptedFileScope(files, scope));
      manager = acquirePreferredProviderManager(
        config,
        settings,
        settingsOwner,
        files,
        runtimeId,
        credentials().authority,
        release,
      );
      oauth = acquirePreferredOAuth(
        undefined,
        bus,
        config,
        settings,
        manager,
        runtimeId,
        undefined,
        credentials().authority,
        release,
        undefined,
      );
      await settingsOwner.startTelemetry(config);
      manager.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId,
          runtimeKind: 'agent',
          metadata: { source: 'phase-07-provider-test' },
        }),
        settingsOwner,
        settings,
        config,
      );
      const ownedOAuth = oauth;
      manager.setRetryOperationsFactory((provider, profileId) =>
        ownedOAuth.composeRetryOperations(
          provider,
          profileId ? { profileId } : undefined,
        ),
      );
      configureProviderRuntimeFactories(config, manager);
      manager.setConfig(config);
      acquisitionComplete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(retiring.splice(0).reverse()),
      );
    }
  }

  it('preserves the session MessageBus in an explicitly composed provider manager', async () => {
    await openCaller(
      'provider-manager-runtime-seam',
      'provider-manager-runtime-seam',
      'provider-manager-runtime-model',
    );
    const isolatedManager = manager;
    const isolatedOAuth = oauth;
    const sessionMessageBus = new MessageBus(
      new PolicyEngine(config.getPolicyEngineConfig()),
      config.getDebugMode(),
    );
    const explicitRelease = new AcquisitionRelease();
    let explicitComplete = false;
    retiring.push(() =>
      explicitComplete ? explicitRelease.close() : explicitRelease.rollback(),
    );
    const explicitFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    explicitRelease.acquire('files', () =>
      releaseAdoptedFileScope(explicitFiles, 'provider-manager-runtime-seam'),
    );
    manager = acquirePreferredProviderManager(
      config,
      settings,
      settingsOwner,
      explicitFiles,
      'provider-manager-runtime-seam',
      credentials().authority,
      explicitRelease,
    );
    manager.setRuntimeContext(
      createProviderRuntimeContext({
        runtimeId: 'provider-manager-runtime-seam',
        metadata: { source: 'phase-07-provider-test' },
      }),
      settingsOwner,
      settings,
      config,
    );
    oauth = acquirePreferredOAuth(
      undefined,
      sessionMessageBus,
      config,
      settings,
      manager,
      'provider-manager-runtime-seam',
      undefined,
      credentials().authority,
      explicitRelease,
      undefined,
    );
    populateProviderManager(
      manager,
      oauth,
      oauth.getTokenStore(),
      settings,
      new NodeFileSystem(),
      config,
      undefined,
      undefined,
      false,
      true,
      undefined,
    );
    explicitComplete = true;
    expect(new Set([manager, isolatedManager]).size).toBe(2);
    expect(new Set([oauth, isolatedOAuth]).size).toBe(2);
    const registeredProviders = manager.listProviders().sort();
    const supportedOAuthProviders = oauth.getSupportedProviders().sort();
    expect(registeredProviders).toStrictEqual(
      expect.arrayContaining(['anthropic', 'codex', 'openai']),
    );
    expect(supportedOAuthProviders).toStrictEqual(
      expect.arrayContaining(['claudecode', 'codex']),
    );
    expect(supportedOAuthProviders).not.toContain('qwen');
    expect(oauth.runtimeMessageBus).toBe(sessionMessageBus);
  });
});
