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
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../agents/src/core/subagent-cleanup.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import { configureProviderRuntimeFactories } from '../composition/index.js';
import { SessionProviderReads } from '../../../agents/src/api/session-provider-reads.js';
import { activateAdoptedProviders } from '../../../agents/src/api/adopted-provider-assembly.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('isolated activation preserves explicit foreground ownership (issue #2300)', () => {
  const credentials = useOwnedCredentials();

  const foregroundRetiring: Array<() => void | Promise<void>> = [];
  let foregroundConfig: Config;
  let foregroundSettings: SettingsService;
  let foregroundSettingsOwner: SessionSettingsOwner;
  let foregroundManager: ProviderManager;
  let foregroundOauth: OAuthManager;
  let foregroundFiles: ProviderFileLifecycle;
  let foregroundBus: MessageBus;
  afterEach(async () => {
    await runCleanupSteps(foregroundRetiring.splice(0).reverse());
  });
  async function openForeground(
    runtimeId: string,
    sessionId: string,
    model: string,
    suppliedBus: MessageBus | undefined = undefined,
  ): Promise<void> {
    try {
      const rawDirectory = await mkdtemp(
        join(tmpdir(), 'provider-foregroundBus-owner-'),
      );
      foregroundRetiring.push(() =>
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
      foregroundConfig = selectedConfig;
      foregroundRetiring.push(() => selectedConfig.dispose());
      const release = new AcquisitionRelease();
      let acquisitionComplete = false;
      foregroundRetiring.push(() =>
        acquisitionComplete ? release.close() : release.rollback(),
      );
      foregroundSettings = new SettingsService();
      const selectedSettingsOwner = new SessionSettingsOwner(
        foregroundSettings,
      );
      foregroundSettingsOwner = selectedSettingsOwner;
      release.acquire('settings', () => selectedSettingsOwner.dispose());
      foregroundSettingsOwner.bindTelemetry(foregroundConfig);
      const policy = new RuntimePolicyOwner(foregroundConfig);
      release.acquire('policy', () => policy.dispose());
      foregroundBus = suppliedBus ?? policy.session.messageBus;
      foregroundFiles = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of new Set([runtimeId, sessionId]))
        release.acquire('files', () =>
          releaseAdoptedFileScope(foregroundFiles, scope),
        );
      foregroundManager = acquirePreferredProviderManager(
        foregroundConfig,
        foregroundSettings,
        foregroundSettingsOwner,
        foregroundFiles,
        runtimeId,
        credentials().authority,
        release,
      );
      foregroundOauth = acquirePreferredOAuth(
        undefined,
        foregroundBus,
        foregroundConfig,
        foregroundSettings,
        foregroundManager,
        runtimeId,
        undefined,
        credentials().authority,
        release,
      );
      acquisitionComplete = true;
      await activateForeground();
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(foregroundRetiring.splice(0).reverse()),
      );
    }
  }

  async function activateForeground(): Promise<void> {
    await preparePreferredProviderCompletion(
      foregroundConfig,
      foregroundSettings,
      foregroundSettingsOwner,
      foregroundManager,
      foregroundOauth,
      foregroundConfig.getSessionId(),
      configureProviderRuntimeFactories(foregroundConfig, foregroundManager)
        .tokenizerFactory,
    );
  }

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

  async function activateFirst(): Promise<void> {
    await preparePreferredProviderCompletion(
      firstConfig,
      firstSettings,
      firstSettingsOwner,
      firstManager,
      firstOauth,
      firstConfig.getSessionId(),
      configureProviderRuntimeFactories(firstConfig, firstManager)
        .tokenizerFactory,
    );
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

  async function activateSecond(): Promise<void> {
    await preparePreferredProviderCompletion(
      secondConfig,
      secondSettings,
      secondSettingsOwner,
      secondManager,
      secondOauth,
      secondConfig.getSessionId(),
      configureProviderRuntimeFactories(secondConfig, secondManager)
        .tokenizerFactory,
    );
  }

  it.each(['wrapper', 'direct'])(
    '%s activation keeps foreground provider and OAuth infrastructure unchanged',
    async (activation) => {
      await openForeground('same-label', 'same-label', 'owner-model');
      foregroundSettings.set('activeProvider', 'kimi');
      await openFirst('same-label', 'same-label', 'owner-model');
      if (activation === 'wrapper')
        await activateAdoptedProviders(
          firstConfig,
          firstSettings,
          firstSettingsOwner,
          firstManager,
          firstOauth,
          'same-label',
          true,
          configureProviderRuntimeFactories(firstConfig, firstManager)
            .tokenizerFactory,
        );
      else await activateFirst();
      expect(
        new SessionProviderReads(
          foregroundSettingsOwner,
          foregroundManager,
          () => foregroundConfig.getModel(),
          (provider) => foregroundSettings.getProviderSettings(provider),
        ).getActiveProviderName(),
      ).toBe('kimi');
      expect('providerManager' in foregroundConfig).toBe(false);
      expect(foregroundManager.listProviders()).toContain('openai');
      expect(firstOauth).not.toBe(foregroundOauth);
    },
  );

  it('isolated cleanup cannot clear the same-label foreground OAuth or provider manager', async () => {
    await openForeground('same-label', 'same-label', 'owner-model');
    await openFirst('same-label', 'same-label', 'owner-model');
    await activateFirst();
    await closeFirst();
    expect(firstFiles.retainsScope('session', 'same-label')).toBe(false);
    expect(foregroundOauth.runtimeMessageBus).toBe(foregroundBus);
    expect(foregroundManager.listProviders()).toContain('openai');
  });

  it('cleanup leaves a foreground owner created after isolated activation usable', async () => {
    await openFirst('same-label', 'same-label', 'owner-model');
    await activateFirst();
    await openForeground('same-label', 'same-label', 'owner-model');
    await closeFirst();
    expect(foregroundOauth.runtimeMessageBus).toBe(foregroundBus);
    expect('providerManager' in foregroundConfig).toBe(false);
  });

  it('parallel isolated activation never supplies an implicit foreground default', async () => {
    await openForeground('same-label', 'same-label', 'owner-model');
    await openFirst('same-label', 'same-label', 'owner-model');
    await openSecond('same-label', 'same-label', 'owner-model');
    await Promise.all([activateFirst(), activateSecond()]);
    expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect(firstOauth).not.toBe(secondOauth);
    await closeFirst();
    expect(secondOauth.getSupportedProviders()).toContain('codex');
    expect(foregroundOauth.runtimeMessageBus).toBe(foregroundBus);
  });
});
