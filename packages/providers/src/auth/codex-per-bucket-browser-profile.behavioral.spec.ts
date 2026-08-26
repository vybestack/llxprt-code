/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'bun:test';
import type { ISecureStore } from '@vybestack/llxprt-code-auth';
import {
  startLocalOAuthCallback,
  type LocalOAuthCallbackOptions,
} from './local-oauth-callback.js';

void vi.mock(
  '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js',
  () => ({
    openBrowserSecurely: vi.fn().mockResolvedValue(undefined),
    shouldLaunchBrowser: vi.fn().mockReturnValue(true),
  }),
);

void vi.mock('./local-oauth-callback.js', () => ({
  startLocalOAuthCallback: vi.fn(
    async (options: LocalOAuthCallbackOptions) => ({
      redirectUri: 'http://127.0.0.1:1455/callback',
      waitForCallback: async () => ({
        code: `code-${options.state}`,
        state: options.state,
      }),
      shutdown: async () => {},
    }),
  ),
}));

import { CodexOAuthProvider } from './codex-oauth-provider.js';
import { oauthRuntimeBridge } from './runtime-accessor-bridge.js';
import {
  openBrowserSecurely,
  shouldLaunchBrowser,
} from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';

function createInMemorySecureStore(): ISecureStore {
  const entries = new Map<string, string>();
  return {
    get: async (key) => entries.get(key) ?? null,
    set: async (key, value) => void entries.set(key, value),
    delete: async (key) => void entries.delete(key),
    list: async () => [...entries.keys()],
    has: async (key) => entries.has(key),
  };
}

function bucketForState(
  stateToBucket: ReadonlyMap<string, string>,
  state: string | null,
): string | undefined {
  return state === null ? undefined : stateToBucket.get(state);
}

function createIdToken(accountId: string): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ account_id: accountId })}.signature`;
}

describe('Codex per-bucket browser profile selection', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    (shouldLaunchBrowser as Mock<typeof shouldLaunchBrowser>).mockReturnValue(
      true,
    );
    globalThis.fetch = vi.fn(async (_input, init) => {
      const body = new URLSearchParams(String(init?.body));
      const accountId = body.get('code')?.slice(0, 12) ?? 'codex-account';
      return new Response(
        JSON.stringify({
          access_token: `access-${accountId}`,
          refresh_token: `refresh-${accountId}`,
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: createIdToken(accountId),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => undefined,
      getRuntimeContext: () => undefined,
      getCurrentProfileName: () => null,
      getBrowserProfileAssociation: (_provider, bucket) => {
        if (bucket === 'work') {
          return { browser: 'chrome', profileDirectory: '/tmp/work-profile' };
        }
        if (bucket === 'personal') {
          return {
            browser: 'chrome',
            profileDirectory: '/tmp/personal-profile',
          };
        }
        return undefined;
      },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => undefined,
      getRuntimeContext: () => undefined,
      getCurrentProfileName: () => null,
      getBrowserProfileAssociation: () => undefined,
    });
  });

  it('completes concurrent public flows with each immutable bucket profile', async () => {
    const provider = new CodexOAuthProvider({
      ...createInMemorySecureStore(),
      saveToken: async () => {},
      getToken: async () => null,
      removeToken: async () => {},
      listProviders: async () => [],
      listBuckets: async () => [],
      getBucketStats: async () => null,
      acquireRefreshLock: async () => true,
      releaseRefreshLock: async () => {},
      acquireAuthLock: async () => true,
      releaseAuthLock: async () => {},
    });

    provider.setAuthContext({ bucket: 'work' });
    const workAuth = provider.initiateAuth();
    provider.setAuthContext({ bucket: 'personal' });
    const personalAuth = provider.initiateAuth();

    const [workToken, personalToken] = await Promise.all([
      workAuth,
      personalAuth,
    ]);
    const browserLaunches = (
      openBrowserSecurely as Mock<typeof openBrowserSecurely>
    ).mock.calls.map(([url, options]) => ({
      state: new URL(url).searchParams.get('state'),
      profileDirectory: options?.profileDirectory,
    }));
    const callbackCalls = (
      startLocalOAuthCallback as Mock<typeof startLocalOAuthCallback>
    ).mock.calls;
    const stateToBucket = new Map([
      [callbackCalls[0][0].state, 'work'],
      [callbackCalls[1][0].state, 'personal'],
    ]);
    const bucketProfiles = Object.fromEntries(
      browserLaunches.map(({ state, profileDirectory }) => [
        bucketForState(stateToBucket, state),
        profileDirectory,
      ]),
    );

    expect({
      bucketProfiles,
      tokensCompleted: [
        workToken.access_token,
        personalToken.access_token,
      ].every((token) => token.startsWith('access-')),
    }).toStrictEqual({
      bucketProfiles: {
        work: '/tmp/work-profile',
        personal: '/tmp/personal-profile',
      },
      tokensCompleted: true,
    });
  });
});
