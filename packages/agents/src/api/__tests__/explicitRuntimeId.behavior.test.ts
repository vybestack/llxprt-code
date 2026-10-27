import { ProviderReadFixture } from './helpers/provider-read-fixture.js';
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
import {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { configureProviderTokenizer } from '@vybestack/llxprt-code-providers/composition.js';

import { prepareAgentPreflight } from '../profile-preflight.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('explicit owner identity at composition boundaries (issue #2300)', () => {
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
        undefined,
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
      configureProviderTokenizer(firstManager),
      undefined,
    );
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
        undefined,
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
      configureProviderTokenizer(secondManager),
      undefined,
    );
  }

  it('uses the supplied foreground Config even after another same-label owner is composed', async () => {
    await openFirst('same-label', 'same-label', 'owner-model');
    await activateFirst();
    await openSecond('same-label', 'same-label', 'owner-model');
    await activateSecond();
    firstSettings.set('activeProvider', 'openai');
    secondSettings.set('activeProvider', 'kimi');
    expect(
      new ProviderReadFixture(
        firstSettingsOwner,
        firstManager,
        () => firstConfig.getModel(),
        (provider) => firstSettings.getProviderSettings(provider),
      ).getActiveProviderName(),
    ).toBe('openai');
    expect(
      new ProviderReadFixture(
        secondSettingsOwner,
        secondManager,
        () => secondConfig.getModel(),
        (provider) => secondSettings.getProviderSettings(provider),
      ).getActiveProviderName(),
    ).toBe('kimi');
    expect(firstOauth).not.toBe(secondOauth);
  });

  it('does not borrow a foreground manager for an owner with no infrastructure', async () => {
    await openFirst('same-label', 'same-label', 'owner-model');
    await activateFirst();
    const incomplete = new Config({
      sessionId: 'incomplete',
      targetDir: firstConfig.getTargetDir(),
      cwd: firstConfig.getTargetDir(),
      model: 'incomplete-model',
      debugMode: false,
    });
    firstRetiring.push(() => incomplete.dispose());
    expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect('runtimeOAuthManager' in incomplete).toBe(false);
  });

  it('requires an explicit owner even after foreground infrastructure exists', async () => {
    await openFirst('same-label', 'same-label', 'owner-model');
    await activateFirst();
    expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect(firstManager.listProviders()).toContain('openai');
  });

  it('isolated construction before foreground bootstrap cannot select foreground infrastructure', async () => {
    await openFirst('before-bootstrap', 'same-label', 'owner-model');
    await openSecond('after-bootstrap', 'after-bootstrap', 'owner-model');
    await activateSecond();
    await activateFirst();
    expect('providerManager' in secondConfig).toBe(false);
    expect(firstOauth.runtimeMessageBus).not.toBe(
      secondOauth.runtimeMessageBus,
    );
    expect(firstOauth).not.toBe(secondOauth);
  });

  it('rejects invalid isolated labels before attaching file infrastructure', async () => {
    const config = new Config({
      sessionId: 'invalid-owner',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      model: 'invalid-model',
      debugMode: false,
    });
    firstRetiring.push(() => config.dispose());
    for (const runtimeId of ['', '  ']) {
      await expect(
        prepareAgentPreflight(
          { runtimeId },
          credentials().authority,
          new SettingsService(),
        ),
      ).rejects.toThrow('runtimeId');
    }
    expect('providerFileLifecycle' in config).toBe(false);
  });
});
