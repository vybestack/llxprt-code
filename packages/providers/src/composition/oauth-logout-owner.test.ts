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
  preparePreferredProviderCompletion,
} from '../../../agents/src/api/preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../agents/src/core/subagent-cleanup.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import {
  populateProviderManager,
  NodeFileSystem,
  configureProviderTokenizer,
} from '../composition/index.js';
import {
  createTestProvider,
  makeToken,
} from '../auth/__tests__/behavioral/test-utils.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

describe('logout ownership', () => {
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

  async function activateFirst(
    construction: 'composition' | 'isolated',
  ): Promise<void> {
    if (construction === 'composition') {
      firstManager.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId: firstConfig.getSessionId(),
          runtimeKind: 'cli-interactive',
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
    } else
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
        undefined,
      );
      acquisitionComplete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(secondRetiring.splice(0).reverse()),
      );
    }
  }

  async function activateSecond(
    construction: 'composition' | 'isolated',
  ): Promise<void> {
    if (construction === 'composition') {
      secondManager.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId: secondConfig.getSessionId(),
          runtimeKind: 'cli-interactive',
        }),
        secondSettingsOwner,
        secondSettings,
        secondConfig,
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
    } else
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
  async function closeSecond(): Promise<void> {
    await runCleanupSteps(secondRetiring.splice(0).reverse());
  }
  it.each(['composition', 'isolated'] as const)(
    '%s logout removes A credentials while B credentials remain usable',
    async (construction) => {
      await openFirst(
        'logout-owner-a-' + construction,
        'logout-owner-a-' + construction,
        'gpt-5',
      );
      await openSecond(
        'logout-owner-b-' + construction,
        'logout-owner-b-' + construction,
        'gpt-5',
      );
      await activateFirst(construction);
      await activateSecond(construction);
      try {
        for (const [owner, bucket] of [
          [firstOauth, 'a'],
          [secondOauth, 'b'],
        ] as const) {
          owner.registerProvider(
            createTestProvider('anthropic', {
              initiateAuthResult: makeToken(`credential-${bucket}`),
            }),
          );
          await owner.authenticate('anthropic', bucket);
          owner.setSessionBucket('anthropic', bucket);
        }
        const credentialB = await secondOauth.getOAuthToken('anthropic');

        await firstOauth.logout('anthropic');

        expect(await firstOauth.getOAuthToken('anthropic', 'a')).toBeNull();
        expect(await secondOauth.getOAuthToken('anthropic', 'b')).toStrictEqual(
          credentialB,
        );
      } finally {
        await runCleanupSteps([
          () => secondOauth.logout('anthropic', 'b'),
          closeFirst,
          closeSecond,
        ]);
      }
    },
  );
});
