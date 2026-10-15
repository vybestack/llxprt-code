/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createProviderRuntimeContext,
  type RuntimeKind,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { acquirePreferredProviderManager } from '../../../agents/src/api/preferred-provider-acquisition.js';
import { acquireAdoptedOAuth } from '../../../agents/src/api/adopted-provider-assembly.js';
import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../agents/src/core/subagent-cleanup.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { createOwnerOAuthManager } from '../composition/owner-oauth-construction.js';
import {
  createOAuthProfileReads,
  createSessionAuthPolicyReader,
  createOwnerAuthCacheInvalidator,
  createOwnedTokenStoreClose,
} from '../composition/index.js';
import { createFileOAuthSettingsProvider } from './file-oauth-settings.js';
import { OAuthManager } from './oauth-manager.js';
import type { TokenStore } from './types.js';
import {
  MemoryTokenStore,
  createTestProvider,
  makeToken,
} from './__tests__/behavioral/test-utils.js';
import {
  InteractiveAuthUnavailableError,
  InteractiveAuthCoordinator,
  type InteractiveAuthChallenge,
} from './interactive-auth-coordinator.js';
import { requestInteractiveAuthentication } from './interactive-auth-request.js';
describe('explicit OAuth owner identity', () => {
  const credentials = useOwnedCredentials();

  let firstConfig: Config;
  let firstSettings: SettingsService;
  let firstOwner: SessionSettingsOwner;
  let firstManager: ProviderManager;
  let firstOAuth: OAuthManager;
  const firstClosing: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await runCleanupSteps(firstClosing.splice(0).reverse());
  });
  async function openFirst(
    kind: RuntimeKind,
    store: TokenStore | undefined,
    supplied: OAuthManager | undefined,
    config: Config | undefined,
  ): Promise<void> {
    const release = new AcquisitionRelease();
    let complete = false;
    firstClosing.push(() => (complete ? release.close() : release.rollback()));
    try {
      if (config === undefined) {
        const raw = await mkdtemp(join(tmpdir(), 'auth-identity-'));
        firstClosing.unshift(() => rm(raw, { recursive: true, force: true }));
        const directory = await realpath(raw);
        config = new Config({
          sessionId: 'same-label',
          targetDir: directory,
          cwd: directory,
          debugMode: false,
          model: 'test',
        });
        const owned = config;
        firstClosing.splice(1, 0, () => owned.dispose());
      }
      firstConfig = config;
      const settings = new SettingsService();
      firstSettings = settings;
      const owner = new SessionSettingsOwner(settings);
      firstOwner = owner;
      release.acquire('settings', () => owner.dispose());
      owner.bindTelemetry(config);
      owner.writeUserParameter('auth-key', 'test-key');
      const policy = new RuntimePolicyOwner(config);
      release.acquire('policy', () => policy.dispose());
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      release.acquire('files', () =>
        releaseAdoptedFileScope(files, 'same-label'),
      );
      firstManager = acquirePreferredProviderManager(
        config,
        settings,
        owner,
        files,
        'same-label',
        credentials().authority,
        release,
      );
      firstManager.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId: 'same-label',
          runtimeKind: kind,
        }),
        owner,
        settings,
        config,
      );
      if (supplied !== undefined) {
        firstOAuth = acquireAdoptedOAuth(
          supplied,
          store,
          policy.session.messageBus,
          config,
          settings,
          firstManager,
          'same-label',
          undefined,
          credentials().authority,
          release,
        );
      } else {
        const tokens = store ?? credentials().authority.createTokenStore();
        if (store === undefined)
          release.acquire('tokens', createOwnedTokenStoreClose(tokens));
        firstOAuth = createOwnerOAuthManager(
          tokens,
          createFileOAuthSettingsProvider(),
          policy.session.messageBus,
          createOAuthProfileReads(config.profileDirectory),
          createSessionAuthPolicyReader(settings),
          () => firstManager.getAuthIdentity(),
          undefined,
          createOwnerAuthCacheInvalidator((provider) =>
            firstManager.getProviderByName(provider),
          ),
          firstManager.fetchNetwork,
        );
        release.acquire('oauth', () => firstOAuth.dispose());
      }
      complete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(firstClosing.splice(0).reverse()),
      );
    }
  }
  function activateFirst(runtimeId: string, runtimeKind: RuntimeKind): void {
    firstManager.setRuntimeContext(
      createProviderRuntimeContext({ runtimeId, runtimeKind }),
      firstOwner,
      firstSettings,
      firstConfig,
    );
  }

  let secondConfig: Config;
  let secondSettings: SettingsService;
  let secondOwner: SessionSettingsOwner;
  let secondManager: ProviderManager;
  let secondOAuth: OAuthManager;
  const secondClosing: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    await runCleanupSteps(secondClosing.splice(0).reverse());
  });
  async function openSecond(
    kind: RuntimeKind,
    store: TokenStore | undefined,
    supplied: OAuthManager | undefined,
    config: Config | undefined,
    settings: SettingsService,
  ): Promise<void> {
    const release = new AcquisitionRelease();
    let complete = false;
    secondClosing.push(() => (complete ? release.close() : release.rollback()));
    try {
      if (config === undefined) {
        const raw = await mkdtemp(join(tmpdir(), 'auth-identity-'));
        secondClosing.unshift(() => rm(raw, { recursive: true, force: true }));
        const directory = await realpath(raw);
        config = new Config({
          sessionId: 'same-label',
          targetDir: directory,
          cwd: directory,
          debugMode: false,
          model: 'test',
        });
        const owned = config;
        secondClosing.splice(1, 0, () => owned.dispose());
      }
      secondConfig = config;
      secondSettings = settings;
      const owner = new SessionSettingsOwner(settings);
      secondOwner = owner;
      release.acquire('settings', () => owner.dispose());
      owner.bindTelemetry(config);
      owner.writeUserParameter('auth-key', 'test-key');
      const policy = new RuntimePolicyOwner(config);
      release.acquire('policy', () => policy.dispose());
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      release.acquire('files', () =>
        releaseAdoptedFileScope(files, 'same-label'),
      );
      secondManager = acquirePreferredProviderManager(
        config,
        settings,
        owner,
        files,
        'same-label',
        credentials().authority,
        release,
      );
      secondManager.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId: 'same-label',
          runtimeKind: kind,
        }),
        owner,
        settings,
        config,
      );
      if (supplied !== undefined) {
        secondOAuth = acquireAdoptedOAuth(
          supplied,
          store,
          policy.session.messageBus,
          config,
          settings,
          secondManager,
          'same-label',
          undefined,
          credentials().authority,
          release,
        );
      } else {
        const tokens = store ?? credentials().authority.createTokenStore();
        if (store === undefined)
          release.acquire('tokens', createOwnedTokenStoreClose(tokens));
        secondOAuth = createOwnerOAuthManager(
          tokens,
          createFileOAuthSettingsProvider(),
          policy.session.messageBus,
          createOAuthProfileReads(config.profileDirectory),
          createSessionAuthPolicyReader(settings),
          () => secondManager.getAuthIdentity(),
          undefined,
          createOwnerAuthCacheInvalidator((provider) =>
            secondManager.getProviderByName(provider),
          ),
          secondManager.fetchNetwork,
        );
        release.acquire('oauth', () => secondOAuth.dispose());
      }
      complete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(secondClosing.splice(0).reverse()),
      );
    }
  }
  function activateSecond(runtimeId: string, runtimeKind: RuntimeKind): void {
    secondManager.setRuntimeContext(
      createProviderRuntimeContext({ runtimeId, runtimeKind }),
      secondOwner,
      secondSettings,
      secondConfig,
    );
  }
  it('gives same-label runtime owners distinct default credential stores', async () => {
    await openFirst('agent', undefined, undefined, undefined);
    await openSecond(
      'agent',
      undefined,
      undefined,
      undefined,
      new SettingsService(),
    );
    expect(firstOAuth.getTokenStore()).not.toBe(secondOAuth.getTokenStore());
  });
  it('keeps caller-owned credentials separate across interleaved same-label runtimes', async () => {
    const firstStore = new MemoryTokenStore();
    const secondStore = new MemoryTokenStore();
    await openFirst('agent', firstStore, undefined, undefined);
    await openSecond(
      'agent',
      secondStore,
      undefined,
      undefined,
      new SettingsService(),
    );
    expect(firstOAuth.getTokenStore()).toBe(firstStore);
    expect(secondOAuth.getTokenStore()).toBe(secondStore);
    await Promise.all([
      (async () => {
        await Promise.resolve();
        await firstOAuth.getTokenStore().saveToken('codex', makeToken('first'));
      })(),
      (async () => {
        await Promise.resolve();
        await secondOAuth
          .getTokenStore()
          .saveToken('codex', makeToken('second'));
      })(),
    ]);
    expect((await firstStore.getToken('codex'))?.access_token).toBe('first');
    expect((await secondStore.getToken('codex'))?.access_token).toBe('second');
  });
  async function enable(oauth: OAuthManager): Promise<void> {
    oauth.registerProvider(createTestProvider('owner-identity'));
    if (!oauth.isOAuthEnabled('owner-identity'))
      await oauth.toggleOAuthEnabled('owner-identity');
  }
  it('routes same-label owners outside ALS independently and reads activation overrides', async () => {
    await openFirst('agent', undefined, undefined, undefined);
    await openSecond(
      'cli-interactive',
      undefined,
      undefined,
      undefined,
      new SettingsService(),
    );
    await enable(firstOAuth);
    await enable(secondOAuth);
    const challenges: InteractiveAuthChallenge[] = [];
    for (const manager of [firstOAuth, secondOAuth])
      manager.bindInteractiveAuthHost(async (challenge) => {
        challenges.push(challenge);
      });
    await Promise.all([
      firstOAuth.getToken('owner-identity', 'alpha'),
      secondOAuth.getToken('owner-identity', 'beta'),
    ]);
    expect(
      [...challenges]
        .sort((a, b) => a.bucket.localeCompare(b.bucket))
        .map((c) => c.requester),
    ).toStrictEqual([
      { runtimeKind: 'agent', runtimeId: 'same-label' },
      { runtimeKind: 'cli-interactive', runtimeId: 'same-label' },
    ]);
    activateFirst('activated-owner', 'subagent');

    await secondOAuth.getToken('owner-identity', 'gamma');
    await firstOAuth.getToken('owner-identity', 'delta');
    expect(challenges.slice(2).map((c) => c.requester)).toStrictEqual([
      { runtimeKind: 'cli-interactive', runtimeId: 'same-label' },
      { runtimeKind: 'subagent', runtimeId: 'activated-owner' },
    ]);
  });
  it('reads CLI manager identity changes without borrowing the active runtime', async () => {
    await openFirst('agent', undefined, undefined, undefined);
    await openSecond(
      'cli-bootstrap',
      undefined,
      undefined,
      firstConfig,
      firstSettings,
    );
    expect(secondSettings).toBe(firstSettings);
    firstSettings.set('auth.noBrowser', true);
    expect(secondOAuth.isBrowserDisabled()).toBe(true);
    firstSettings.set('auth.noBrowser', false);
    activateSecond('foreground', 'cli-bootstrap');
    await enable(secondOAuth);
    const challenges: InteractiveAuthChallenge[] = [];
    secondOAuth.bindInteractiveAuthHost(async (challenge) => {
      challenges.push(challenge);
    });

    await secondOAuth.getToken('owner-identity', 'bootstrap');
    activateSecond('foreground-active', 'cli-interactive');
    activateFirst('unrelated', 'subagent');

    await secondOAuth.getToken('owner-identity', 'foreground');
    expect(challenges.map((c) => c.requester)).toStrictEqual([
      { runtimeId: 'foreground', runtimeKind: 'cli-bootstrap' },
      { runtimeId: 'foreground-active', runtimeKind: 'cli-interactive' },
    ]);
  });
  it('rejects background authentication without a host using a typed error', async () => {
    await openFirst('subagent', undefined, undefined, undefined);
    await enable(firstOAuth);
    await expect(
      firstOAuth.getToken('owner-identity', 'required'),
    ).rejects.toBeInstanceOf(InteractiveAuthUnavailableError);
  });
  it('preserves an adopted OAuth manager owner when the adopting runtime activates', async () => {
    await openFirst('cli-interactive', undefined, undefined, undefined);
    await enable(firstOAuth);
    await openSecond(
      'agent',
      undefined,
      firstOAuth,
      firstConfig,
      firstSettings,
    );
    activateSecond('adopter-active', 'subagent');

    const challenges: InteractiveAuthChallenge[] = [];
    secondOAuth.bindInteractiveAuthHost(async (challenge) => {
      challenges.push(challenge);
    });
    await secondOAuth.getToken('owner-identity', 'adopted');
    expect(challenges.map((c) => c.requester)).toStrictEqual([
      { runtimeId: 'same-label', runtimeKind: 'cli-interactive' },
    ]);
  });
  it('keeps undefined identity unregistered and excludes mismatched requester IDs', async () => {
    const challenges: InteractiveAuthChallenge[] = [];
    const coordinator = new InteractiveAuthCoordinator();
    const host = async (challenge: InteractiveAuthChallenge): Promise<void> => {
      challenges.push(challenge);
    };
    coordinator.bindHost(host);
    const oauth = new OAuthManager(new MemoryTokenStore());
    firstClosing.push(() => oauth.dispose());
    firstClosing.push(() => coordinator.dispose());
    oauth.bindInteractiveAuthHost(host);
    await enable(oauth);
    await oauth.getToken('owner-identity', 'unknown');
    await requestInteractiveAuthentication(
      coordinator,
      'owner-identity',
      'mismatch',
      'subagent',
      'authentication-required',
      undefined,
      { runtimeId: 'foreground', runtimeKind: 'cli-interactive' },
    );
    await requestInteractiveAuthentication(
      coordinator,
      'owner-identity',
      'match',
      'agent',
      'authentication-required',
      undefined,
      { runtimeId: 'background', runtimeKind: 'agent' },
    );
    expect(challenges.map((c) => c.requester)).toStrictEqual([
      { runtimeKind: 'unregistered' },
      { runtimeKind: 'subagent' },
      { runtimeKind: 'agent', runtimeId: 'background' },
    ]);
  });
});
