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
import { ProviderFileLifecycle, ProviderManager } from '../../index.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from '../../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../../agents/src/api/adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../../agents/src/core/subagent-cleanup.js';
import { useOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { OAuthManager } from '../../auth/oauth-manager.js';
import {
  populateProviderManager,
  NodeFileSystem,
} from '../../composition/index.js';

import { AnthropicProvider } from '../../anthropic/AnthropicProvider.js';
class BoundManagerExposingProvider extends AnthropicProvider {
  get boundOAuthManager(): unknown {
    return (
      this as unknown as { baseProviderConfig: { oauthManager?: unknown } }
    ).baseProviderConfig.oauthManager;
  }
}

describe('issue #2891: provider OAuth identity is owner-bound', () => {
  const credentials = useOwnedCredentials();

  const firstRetiring: Array<() => void | Promise<void>> = [];
  let firstConfig: Config;
  let firstSettings: SettingsService;
  let firstSettingsOwner: SessionSettingsOwner;
  let firstManager: ProviderManager;
  let firstOauth: OAuthManager;
  let firstFiles: ProviderFileLifecycle;
  let firstBus: MessageBus;
  afterEach(async () => {
    await runCleanupSteps(firstRetiring.splice(0).reverse());
  });
  async function openFirst(
    runtimeId: string,
    sessionId: string,
    model: string,
    suppliedBus: MessageBus | undefined = undefined,
  ): Promise<void> {
    try {
      const rawDirectory = await mkdtemp(
        join(tmpdir(), 'provider-firstBus-owner-'),
      );
      firstRetiring.push(() =>
        rm(rawDirectory, { recursive: true, force: true }),
      );
      const directory = await realpath(rawDirectory);
      const selectedConfig = new Config({
        sessionId,
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      firstConfig = selectedConfig;
      firstRetiring.push(() => selectedConfig.dispose());
      const release = new AcquisitionRelease();
      let acquisitionComplete = false;
      firstRetiring.push(() =>
        acquisitionComplete ? release.close() : release.rollback(),
      );
      firstSettings = new SettingsService();
      const selectedSettingsOwner = new SessionSettingsOwner(firstSettings);
      firstSettingsOwner = selectedSettingsOwner;
      release.acquire('settings', () => selectedSettingsOwner.dispose());
      firstSettingsOwner.bindTelemetry(firstConfig);
      const policy = new RuntimePolicyOwner(firstConfig);
      release.acquire('policy', () => policy.dispose());
      firstBus = suppliedBus ?? policy.session.messageBus;
      firstFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of new Set([runtimeId, sessionId]))
        release.acquire('files', () =>
          releaseAdoptedFileScope(firstFiles, scope),
        );
      firstManager = acquirePreferredProviderManager(
        firstConfig,
        firstSettings,
        firstSettingsOwner,
        firstFiles,
        runtimeId,
        credentials().authority,
        release,
      );
      firstOauth = acquirePreferredOAuth(
        undefined,
        firstBus,
        firstConfig,
        firstSettings,
        firstManager,
        runtimeId,
        undefined,
        credentials().authority,
        release,
      );
      acquisitionComplete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(firstRetiring.splice(0).reverse()),
      );
    }
  }

  async function closeFirst(): Promise<void> {
    await runCleanupSteps(firstRetiring.splice(0).reverse());
  }

  const secondRetiring: Array<() => void | Promise<void>> = [];
  let secondConfig: Config;
  let secondSettings: SettingsService;
  let secondSettingsOwner: SessionSettingsOwner;
  let secondManager: ProviderManager;
  let secondOauth: OAuthManager;
  let secondFiles: ProviderFileLifecycle;
  let secondBus: MessageBus;
  afterEach(async () => {
    await runCleanupSteps(secondRetiring.splice(0).reverse());
  });
  async function openSecond(
    runtimeId: string,
    sessionId: string,
    model: string,
    suppliedBus: MessageBus | undefined = undefined,
  ): Promise<void> {
    try {
      const rawDirectory = await mkdtemp(
        join(tmpdir(), 'provider-secondBus-owner-'),
      );
      secondRetiring.push(() =>
        rm(rawDirectory, { recursive: true, force: true }),
      );
      const directory = await realpath(rawDirectory);
      const selectedConfig = new Config({
        sessionId,
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      secondConfig = selectedConfig;
      secondRetiring.push(() => selectedConfig.dispose());
      const release = new AcquisitionRelease();
      let acquisitionComplete = false;
      secondRetiring.push(() =>
        acquisitionComplete ? release.close() : release.rollback(),
      );
      secondSettings = new SettingsService();
      const selectedSettingsOwner = new SessionSettingsOwner(secondSettings);
      secondSettingsOwner = selectedSettingsOwner;
      release.acquire('settings', () => selectedSettingsOwner.dispose());
      secondSettingsOwner.bindTelemetry(secondConfig);
      const policy = new RuntimePolicyOwner(secondConfig);
      release.acquire('policy', () => policy.dispose());
      secondBus = suppliedBus ?? policy.session.messageBus;
      secondFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of new Set([runtimeId, sessionId]))
        release.acquire('files', () =>
          releaseAdoptedFileScope(secondFiles, scope),
        );
      secondManager = acquirePreferredProviderManager(
        secondConfig,
        secondSettings,
        secondSettingsOwner,
        secondFiles,
        runtimeId,
        credentials().authority,
        release,
      );
      secondOauth = acquirePreferredOAuth(
        undefined,
        secondBus,
        secondConfig,
        secondSettings,
        secondManager,
        runtimeId,
        undefined,
        credentials().authority,
        release,
      );
      acquisitionComplete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(secondRetiring.splice(0).reverse()),
      );
    }
  }

  async function closeSecond(): Promise<void> {
    await runCleanupSteps(secondRetiring.splice(0).reverse());
  }

  it('keeps each provider bound to its own Config OAuth manager across sibling startup and cleanup', async () => {
    await openFirst(
      'oauth-identity-first',
      'oauth-identity-first',
      'test-model',
    );
    firstManager.setRuntimeContext(
      createProviderRuntimeContext({
        runtimeId: 'oauth-identity-first',
        runtimeKind: 'cli-bootstrap',
      }),
      firstSettingsOwner,
      firstSettings,
      firstConfig,
    );
    populateProviderManager(
      firstManager,
      firstOauth,
      firstOauth.getTokenStore(),
      firstSettings,
      new NodeFileSystem(),
      firstConfig,
      undefined,
      undefined,
      false,
      true,
      undefined,
    );
    const boundA = new BoundManagerExposingProvider(
      undefined,
      undefined,
      undefined,
      firstOauth,
    );
    try {
      await openSecond(
        'oauth-identity-second',
        'oauth-identity-second',
        'test-model',
      );
      populateProviderManager(
        secondManager,
        secondOauth,
        secondOauth.getTokenStore(),
        secondSettings,
        new NodeFileSystem(),
        secondConfig,
        undefined,
        undefined,
        false,
        true,
        undefined,
      );
      const boundB = new BoundManagerExposingProvider(
        undefined,
        undefined,
        undefined,
        secondOauth,
      );
      try {
        expect(boundA.boundOAuthManager).toBe(firstOauth);
        expect(boundB.boundOAuthManager).toBe(secondOauth);
        expect(boundA.boundOAuthManager).not.toBe(boundB.boundOAuthManager);
        expect(boundA.boundOAuthManager).toBe(firstOauth);
        expect(firstManager.listProviders()).toContain('claudecode');
      } finally {
        await closeSecond();
      }
    } finally {
      await closeFirst();
    }
  });
});
