import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProviderManager } from '../ProviderManager.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import {
  createOwnedTokenStoreClose,
  createSessionAuthPolicyReader,
  createOwnerAuthCacheInvalidator,
  populateProviderManager,
} from './index.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from '../../../agents/src/api/preferred-provider-acquisition.js';

import { releaseAdoptedFileScope } from '../../../agents/src/api/adoption-release.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../agents/src/core/subagent-cleanup.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { NodeFileSystem } from './IFileSystem.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { BrowserLaunchOptions } from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
import type { LocalOAuthCallbackOptions } from '../auth/local-oauth-callback.js';
import { MemoryTokenStore } from '../auth/__tests__/behavioral/test-utils.js';
import { AnthropicOAuthProvider } from '../auth/anthropic-oauth-provider.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import { registerStandardOAuthProviders } from './oauth-provider-registration.js';
import { type InteractiveAuthChallenge } from '../auth/interactive-auth-coordinator.js';

const launches: Array<BrowserLaunchOptions | undefined> = [];
import * as browser from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
void vi.mock('../auth/local-oauth-callback.js', () => ({
  startLocalOAuthCallback: async (options: LocalOAuthCallbackOptions) => ({
    redirectUri: 'http://127.0.0.1:1455/callback',
    waitForCallback: async () => ({ code: 'owner-code', state: options.state }),
    shutdown: async () => {},
  }),
}));

type Construction =
  | 'direct'
  | 'composition'
  | 'composition-context'
  | 'isolated';
const originalFetch = globalThis.fetch;
const stubbedOwnerFetch: NetworkFetch = (input, init) =>
  globalThis.fetch(input, init);
describe('OAuth owner reads before registration', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let configA: Config;
  let configB: Config;
  let settingsA: SettingsService;
  let settingsB: SettingsService;
  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });
  async function openContexts(idA: string, idB: string): Promise<void> {
    const raw = await mkdtemp(join(tmpdir(), 'browser-policy-'));
    retiring.push(() => rm(raw, { recursive: true, force: true }));
    const directory = await realpath(raw);
    const first = new Config({
      sessionId: idA,
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'gpt-5',
    });
    configA = first;
    retiring.push(() => first.dispose());
    const second = new Config({
      sessionId: idB,
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'gpt-5',
    });
    configB = second;
    retiring.push(() => second.dispose());
    settingsA = new SettingsService();
    settingsB = new SettingsService();
  }
  async function buildManager(
    config: Config,
    settings: SettingsService,
    construction: Construction,
  ): Promise<OAuthManager> {
    const release = new AcquisitionRelease();
    let complete = false;
    retiring.push(() => (complete ? release.close() : release.rollback()));
    try {
      if (
        construction === 'composition' ||
        construction === 'composition-context'
      ) {
        const oauth = composeOAuth(config, settings, construction, release);
        complete = true;
        return oauth;
      }
      if (construction === 'isolated') {
        const oauth = isolateOAuth(config, settings, release);
        complete = true;
        return oauth;
      }
      const manager = new OAuthManager(new MemoryTokenStore(), undefined, {
        readSessionAuthPolicy: () => ({
          profileName: settings.getCurrentProfileName(),
          baseUrl: undefined,
          bucketPrompt: settings.get('auth-bucket-prompt'),
          bucketDelay: settings.get('auth-bucket-delay'),
          interactiveTimeoutMs: settings.get('auth.interactiveTimeoutMs'),
          noBrowser: settings.get('auth.noBrowser') === true,
          authOnly: settings.get('authOnly') === true,
        }),
      });
      release.acquire('oauth', () => manager.dispose());
      registerStandardOAuthProviders(manager, globalThis.fetch);
      complete = true;
      return manager;
    } catch (primary) {
      return cleanupAfterFailure(primary, () => release.rollback());
    }
  }
  function composeOAuth(
    config: Config,
    settings: SettingsService,
    construction: Construction,
    release: AcquisitionRelease,
  ): OAuthManager {
    const attachedConfig =
      construction === 'composition-context' ? undefined : config;
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      attachedConfig,
      { runtimeId: config.getSessionId() },
    );
    release.acquire('manager', () => manager.dispose());
    manager.bindNetworkFetch(stubbedOwnerFetch);
    const keys = credentials().authority.createProviderKeyStorage();
    release.acquire('manager', () => keys.close());
    manager.bindProviderKeyStorage(keys);
    const tokens = credentials().authority.createTokenStore();
    release.acquire('tokens', createOwnedTokenStoreClose(tokens));
    const oauth = new OAuthManager(tokens, undefined, {
      config: attachedConfig,
      readAuthIdentity: () => manager.getAuthIdentity(),
      readSessionAuthPolicy: createSessionAuthPolicyReader(settings),
      invalidateAuthCaches: createOwnerAuthCacheInvalidator((name) =>
        manager.getProviderByName(name),
      ),
    });
    release.acquire('oauth', () => oauth.dispose());
    populateProviderManager(
      manager,
      oauth,
      tokens,
      settings,
      new NodeFileSystem(),
      attachedConfig,
      undefined,
      undefined,
      false,
      false,
      undefined,
    );
    return oauth;
  }
  function isolateOAuth(
    config: Config,
    settings: SettingsService,
    release: AcquisitionRelease,
  ): OAuthManager {
    const owner = new SessionSettingsOwner(settings);
    release.acquire('settings', () => owner.dispose());
    owner.bindTelemetry(config);
    const policy = new RuntimePolicyOwner(config);
    release.acquire('policy', () => policy.dispose());
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    release.acquire('files', () =>
      releaseAdoptedFileScope(files, config.getSessionId()),
    );
    const manager = acquirePreferredProviderManager(
      config,
      settings,
      owner,
      files,
      config.getSessionId(),
      credentials().authority,
      release,
    );
    manager.bindNetworkFetch(stubbedOwnerFetch);
    return acquirePreferredOAuth(
      undefined,
      policy.session.messageBus,
      config,
      settings,
      manager,
      config.getSessionId(),
      undefined,
      credentials().authority,
      release,
      undefined,
    );
  }
  beforeEach(() => {
    vi.spyOn(browser, 'shouldLaunchBrowser').mockImplementation(
      (options) => options?.forceManual !== true,
    );
    vi.spyOn(browser, 'openBrowserSecurely').mockImplementation(
      async (_url, options) => {
        launches.push(options);
      },
    );
  });
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    launches.length = 0;
    vi.restoreAllMocks();
  });

  it.each([
    ['composition-context', 'codex'],
    ['direct', 'codex'],
    ['composition', 'codex'],
    ['isolated', 'codex'],
    ['composition-context', 'claudecode'],
    ['direct', 'claudecode'],
    ['composition', 'claudecode'],
    ['isolated', 'claudecode'],
  ] as const)(
    '%s %s preserves owner browser policy and bucket routing without an identity scope',
    async (construction, providerName) => {
      const requestFetch = vi.fn(
        async (_input: string | URL | Request, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              id_token: `header.${Buffer.from(JSON.stringify({ account_id: 'owner-account' })).toString('base64url')}.signature`,
              access_token: 'browser-token',
              refresh_token: 'refresh',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'user:inference',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      );
      globalThis.fetch = requestFetch;
      await openContexts(
        `browser-a-${construction}`,
        `browser-b-${construction}`,
      );
      const managerA = await buildManager(configA, settingsA, construction);
      const managerB = await buildManager(configB, settingsB, construction);
      const bucketA = `owner-a-${construction}`;
      const bucketB = `owner-b-${construction}`;
      managerA.setBrowserProfileAssociation(providerName, bucketA, {
        browser: 'chrome',
        profileDirectory: 'Owner A',
      });
      managerB.setBrowserProfileAssociation(providerName, bucketB, {
        browser: 'firefox',
        profileDirectory: 'Owner B',
      });
      try {
        const providerA = managerA.getProvider(providerName);
        const providerB = managerB.getProvider(providerName);
        if (!providerA || !providerB)
          throw new Error('Missing registered providers');
        providerA.setAuthContext?.({ bucket: bucketA });
        providerB.setAuthContext?.({ bucket: bucketB });
        const tokens = await Promise.all([
          providerA.initiateAuth(),
          providerB.initiateAuth(),
        ]);
        expect(tokens.every((token) => token.access_token.length > 0)).toBe(
          true,
        );
        expect(
          launches.map((launch) => launch?.profileDirectory).sort(),
        ).toStrictEqual(['Owner A', 'Owner B']);
        launches.length = 0;
        settingsA.set('auth.noBrowser', true);
        requestFetch.mockImplementation(
          async (input: string | URL | Request) => {
            if (String(input).includes('deviceauth'))
              throw new Error('device-route');
            return new Response(
              JSON.stringify({
                id_token: `header.${Buffer.from(JSON.stringify({ account_id: 'owner-account' })).toString('base64url')}.signature`,
                access_token: 'browser-token',
                expires_in: 3600,
                token_type: 'Bearer',
                scope: 'user:inference',
              }),
              { status: 200 },
            );
          },
        );
        if (providerA instanceof AnthropicOAuthProvider) {
          providerA.setAddItem(() => {
            setImmediate(() => providerA.submitAuthCode('manual-code'));
            return undefined;
          });
          await providerA.initiateAuth();
        } else {
          const result = await providerA
            .initiateAuth()
            .catch((error: unknown) => error);
          if (
            !(result instanceof Error) ||
            !result.message.includes('device-route')
          )
            throw new Error('Expected browserless device flow');
        }
        await providerB.initiateAuth();
        expect(
          launches.map((launch) => launch?.profileDirectory),
        ).toStrictEqual(['Owner B']);
      } finally {
        managerA.clearBrowserProfileAssociation(providerName, bucketA);
        managerB.clearBrowserProfileAssociation(providerName, bucketB);
        await runCleanupSteps(retiring.splice(0).reverse());
      }
    },
  );

  it.each([
    'direct',
    'composition',
    'composition-context',
    'isolated',
  ] as const)(
    '%s uses each manager timeout and carries only its available requester identity',
    async (construction) => {
      await openContexts('timeout-a', 'timeout-b');
      settingsA.set('auth.interactiveTimeoutMs', 20);
      settingsB.set('auth.interactiveTimeoutMs', 10000);
      const challenges: InteractiveAuthChallenge[] = [];
      const managers = [
        await buildManager(configA, settingsA, construction),
        await buildManager(configB, settingsB, construction),
      ];
      for (const manager of managers) {
        if (!manager.isOAuthEnabled('codex'))
          await manager.toggleOAuthEnabled('codex');
      }
      const started = managers.map(
        (manager) =>
          new Promise<void>((resolve) => {
            manager.bindInteractiveAuthHost(async (challenge, signal) => {
              challenges.push(challenge);
              resolve();
              await new Promise<void>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), {
                  once: true,
                });
              });
            });
          }),
      );
      try {
        const first = managers[0]
          .getToken('codex', 'short')
          .catch((error: unknown) => error);
        const second = managers[1]
          .getToken('codex', 'long')
          .catch((error: unknown) => error);
        await Promise.all(started);
        expect(
          await Promise.race([
            first,
            new Promise((resolve) =>
              setTimeout(() => resolve('timeout not applied'), 200),
            ),
          ]),
        ).toMatchObject({ outcomeKind: 'timed_out' });
        const requesterFor = (
          runtimeId: string,
        ): InteractiveAuthChallenge['requester'] => {
          if (construction === 'isolated')
            return { runtimeId, runtimeKind: 'agent' };
          if (
            construction === 'composition' ||
            construction === 'composition-context'
          )
            return { runtimeId, runtimeKind: 'unregistered' };
          return { runtimeKind: 'unregistered' };
        };
        expect(
          challenges
            .map((challenge) => challenge.requester)
            .sort((left, right) =>
              (left.runtimeId ?? '').localeCompare(right.runtimeId ?? ''),
            ),
        ).toStrictEqual([requesterFor('timeout-a'), requesterFor('timeout-b')]);
        expect(managers[1].cancelInteractiveAuth()).toBe(1);
        expect(await second).toMatchObject({
          name: 'InteractiveAuthCancelledError',
        });
      } finally {
        await Promise.all(managers.map((manager) => manager.dispose()));
        await runCleanupSteps(retiring.splice(0).reverse());
      }
    },
  );
});
