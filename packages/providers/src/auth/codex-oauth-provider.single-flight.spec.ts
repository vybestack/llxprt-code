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
import type { TokenStore } from '@vybestack/llxprt-code-auth';
import type { LocalOAuthCallbackOptions } from './local-oauth-callback.js';

vi.mock('@vybestack/llxprt-code-core/utils/secure-browser-launcher.js', () => ({
  openBrowserSecurely: vi.fn().mockResolvedValue(undefined),
  shouldLaunchBrowser: vi.fn().mockReturnValue(true),
}));

vi.mock('./local-oauth-callback.js', () => ({
  startLocalOAuthCallback: vi.fn(
    async (options: LocalOAuthCallbackOptions) => ({
      redirectUri: 'http://127.0.0.1:1455/callback',
      waitForCallback: async () => ({
        code: 'shared-code',
        state: options.state,
      }),
      shutdown: async () => {},
    }),
  ),
}));

import { CodexOAuthProvider } from './codex-oauth-provider.js';
import { startLocalOAuthCallback } from './local-oauth-callback.js';
import {
  openBrowserSecurely,
  shouldLaunchBrowser,
} from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';

function createTokenStore(): TokenStore {
  return {
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
  };
}

function idToken(): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ account_id: 'shared-account' })}.signature`;
}

describe('CodexOAuthProvider public single-flight', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    (shouldLaunchBrowser as Mock<typeof shouldLaunchBrowser>).mockReturnValue(
      true,
    );
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'shared-access',
          refresh_token: 'shared-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: idToken(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('joins two public same-bucket flows before starting callback infrastructure', async () => {
    const provider = new CodexOAuthProvider(createTokenStore());
    provider.setAuthContext({ bucket: 'default' });

    const [first, second] = await Promise.all([
      provider.initiateAuth(),
      provider.initiateAuth(),
    ]);

    expect({
      callbackStarts: (
        startLocalOAuthCallback as Mock<typeof startLocalOAuthCallback>
      ).mock.calls.length,
      first: first.access_token,
      second: second.access_token,
    }).toStrictEqual({
      callbackStarts: 1,
      first: 'shared-access',
      second: 'shared-access',
    });
  });

  it('shuts down the callback and falls back to device auth when browser launch fails', async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const waitForCallback = vi.fn();
    (
      startLocalOAuthCallback as Mock<typeof startLocalOAuthCallback>
    ).mockResolvedValueOnce({
      redirectUri: 'http://127.0.0.1:1455/callback',
      waitForCallback,
      shutdown,
    });
    (
      openBrowserSecurely as Mock<typeof openBrowserSecurely>
    ).mockRejectedValueOnce(new Error('No browser available'));

    const provider = new CodexOAuthProvider(createTokenStore());
    const deviceToken = {
      access_token: 'device-access',
      refresh_token: 'device-refresh',
      token_type: 'Bearer' as const,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      account_id: 'device-account',
    };
    const performDeviceAuth = vi
      .spyOn(
        provider as unknown as {
          performDeviceAuth: (
            signal?: AbortSignal,
          ) => Promise<typeof deviceToken>;
        },
        'performDeviceAuth',
      )
      .mockResolvedValue(deviceToken);

    await expect(provider.initiateAuth()).resolves.toStrictEqual(deviceToken);
    expect(shutdown).toHaveBeenCalledOnce();
    expect(waitForCallback).not.toHaveBeenCalled();
    expect(performDeviceAuth).toHaveBeenCalledOnce();
  });
});
