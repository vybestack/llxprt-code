/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';

import { NodeFileSystem } from './IFileSystem.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { BrowserLaunchOptions } from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
import type { LocalOAuthCallbackOptions } from '../auth/local-oauth-callback.js';
import { MemoryTokenStore } from '../auth/__tests__/behavioral/test-utils.js';
import { AnthropicOAuthProvider } from '../auth/anthropic-oauth-provider.js';
import { OAuthManager } from '../auth/oauth-manager.js';
import { registerStandardOAuthProviders } from './oauth-provider-registration.js';
import { createProviderManager } from './providerManagerInstance.js';
import {
  createIsolatedRuntimeContext,
  type RuntimeActivationBindings,
} from '../runtime/runtimeContextFactory.js';

const activationBindings: RuntimeActivationBindings = {
  resetInfrastructure: () => {},
  setRuntimeContext: () => {},
  registerInfrastructure: () => {},
  linkProviderManager: (config, manager) => {
    configureProviderRuntimeFactories(config, manager);
  },
};
import {
  interactiveAuthCoordinator,
  type InteractiveAuthChallenge,
} from '../auth/interactive-auth-coordinator.js';

const launches: Array<BrowserLaunchOptions | undefined> = [];
import * as browser from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
void vi.mock('../auth/local-oauth-callback.js', () => ({
  startLocalOAuthCallback: async (options: LocalOAuthCallbackOptions) => ({
    redirectUri: 'http://127.0.0.1:1455/callback',
    waitForCallback: async () => ({ code: 'owner-code', state: options.state }),
    shutdown: async () => {},
  }),
}));

function context(runtimeId: string) {
  const settingsService = new SettingsService();
  const config = new Config({
    sessionId: runtimeId,
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'gpt-5',
  });
  return { runtimeId, settingsService, config };
}

type Construction =
  | 'direct'
  | 'composition'
  | 'composition-context'
  | 'isolated'
  | 'adopted'
  | 'adopted-live';
function buildManager(
  owner: ReturnType<typeof context>,
  construction: Construction,
  adoptingOwner: ReturnType<typeof context>,
  cleanups: Array<() => void | Promise<void>>,
): OAuthManager {
  if (construction === 'composition-context')
    return createProviderManager(owner, {
      fileSystem: new NodeFileSystem(),
      activateConfiguredProvider: false,
    }).oauthManager;
  if (construction === 'composition')
    return createProviderManager(owner, {
      fileSystem: new NodeFileSystem(),
      config: owner.config,
      activateConfiguredProvider: false,
    }).oauthManager;
  if (construction === 'isolated') {
    const handle = createIsolatedRuntimeContext(
      {
        ...owner,
        activationBindings,
      },
      owner.settingsService,
    );
    cleanups.push(() => handle.cleanup());
    return handle.oauthManager;
  }
  const manager = new OAuthManager(new MemoryTokenStore(), undefined, {
    readSessionAuthPolicy: () => ({
      profileName: owner.settingsService.getCurrentProfileName(),
      baseUrl: undefined,
      bucketPrompt: owner.settingsService.get('auth-bucket-prompt'),
      bucketDelay: owner.settingsService.get('auth-bucket-delay'),
      interactiveTimeoutMs: owner.settingsService.get(
        'auth.interactiveTimeoutMs',
      ),
      noBrowser: owner.settingsService.get('auth.noBrowser') === true,
      authOnly: owner.settingsService.get('authOnly') === true,
    }),
  });
  if (construction === 'adopted-live') registerStandardOAuthProviders(manager);
  if (construction === 'adopted' || construction === 'adopted-live') {
    const handle = createIsolatedRuntimeContext(
      {
        ...adoptingOwner,
        activationBindings,
        oauthManager: manager,
      },
      adoptingOwner.settingsService,
    );
    cleanups.push(() => handle.cleanup());
  } else registerStandardOAuthProviders(manager);
  return manager;
}

const originalFetch = globalThis.fetch;
describe('OAuth owner reads before registration', () => {
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
    await interactiveAuthCoordinator.dispose();
    interactiveAuthCoordinator.unbindHost();
    vi.restoreAllMocks();
  });

  it.each([
    ['composition-context', 'codex'],
    ['adopted-live', 'codex'],
    ['direct', 'codex'],
    ['composition', 'codex'],
    ['isolated', 'codex'],
    ['adopted', 'codex'],
    ['composition-context', 'claudecode'],
    ['adopted-live', 'claudecode'],
    ['direct', 'claudecode'],
    ['composition', 'claudecode'],
    ['isolated', 'claudecode'],
    ['adopted', 'claudecode'],
  ] as const)(
    '%s %s preserves owner browser policy and bucket routing without an identity scope',
    async (construction, providerName) => {
      globalThis.fetch = vi.fn(
        async () =>
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
      const a = context(`browser-a-${construction}`);
      const b = context(`browser-b-${construction}`);
      const cleanups: Array<() => void | Promise<void>> = [];
      const managerA = buildManager(a, construction, b, cleanups);
      const managerB = buildManager(b, construction, b, cleanups);
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
        a.settingsService.set('auth.noBrowser', true);
        globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
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
        });
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
        for (const cleanup of cleanups) await cleanup();
        await a.config.dispose();
        await b.config.dispose();
      }
    },
  );

  it.each([
    'direct',
    'composition',
    'composition-context',
    'isolated',
    'adopted',
    'adopted-live',
  ] as const)(
    '%s uses each manager timeout and carries only its available requester identity',
    async (construction) => {
      const a = context('timeout-a');
      const b = context('timeout-b');
      a.settingsService.set('auth.interactiveTimeoutMs', 20);
      b.settingsService.set('auth.interactiveTimeoutMs', 10000);
      const challenges: InteractiveAuthChallenge[] = [];
      const cleanups: Array<() => void | Promise<void>> = [];
      const managers = [a, b].map((owner) =>
        buildManager(owner, construction, b, cleanups),
      );
      for (const manager of managers) {
        if (!manager.isOAuthEnabled('codex'))
          await manager.toggleOAuthEnabled('codex');
      }
      interactiveAuthCoordinator.bindHost(async (challenge) => {
        challenges.push(challenge);
        await new Promise<void>(() => {});
      });
      try {
        const first = managers[0]
          .getToken('codex', 'short')
          .catch((error: unknown) => error);
        const second = managers[1]
          .getToken('codex', 'long')
          .catch((error: unknown) => error);
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
        expect(interactiveAuthCoordinator.cancelActiveSessions()).toBe(1);
        expect(await second).toMatchObject({
          name: 'InteractiveAuthCancelledError',
        });
      } finally {
        await interactiveAuthCoordinator.dispose();
        for (const cleanup of cleanups) await cleanup();
        await a.config.dispose();
        await b.config.dispose();
      }
    },
  );
});
