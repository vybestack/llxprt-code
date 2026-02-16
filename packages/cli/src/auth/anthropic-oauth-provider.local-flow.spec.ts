import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';

vi.mock('./local-oauth-callback.js', () => ({
  startLocalOAuthCallback: vi.fn(),
}));

import * as coreModule from '@vybestack/llxprt-code-core';
import type {
  DeviceCodeResponse,
  OAuthToken,
  TokenStore,
} from '@vybestack/llxprt-code-core';
import { AnthropicOAuthProvider } from './anthropic-oauth-provider.js';
import { startLocalOAuthCallback } from './local-oauth-callback.js';

const startLocalOAuthCallbackMock = vi.mocked(startLocalOAuthCallback);
const openBrowserArgs: string[] = [];

describe('AnthropicOAuthProvider local callback flow', () => {
  let provider: AnthropicOAuthProvider;
  let tokenStore: TokenStore;
  let deviceFlow: coreModule.AnthropicDeviceFlow;
  let shouldLaunchBrowserSpy: MockInstance;

  beforeEach(() => {
    openBrowserArgs.length = 0;
    startLocalOAuthCallbackMock.mockReset();
    vi.spyOn(global.console, 'log').mockImplementation(() => {});

    const saveToken = vi.fn<TokenStore['saveToken']>(
      async (_provider, _token) => {},
    );
    tokenStore = {
      saveToken,
      getToken: vi.fn<TokenStore['getToken']>(async () => null),
      removeToken: vi.fn<TokenStore['removeToken']>(async () => undefined),
      listProviders: vi.fn<TokenStore['listProviders']>(async () => []),
      listBuckets: vi.fn<TokenStore['listBuckets']>(async () => ['default']),
      getBucketStats: vi.fn<TokenStore['getBucketStats']>(async () => null),
      acquireRefreshLock: vi.fn(async () => true),
      releaseRefreshLock: vi.fn(async () => undefined),
    } satisfies TokenStore;

    provider = new AnthropicOAuthProvider(tokenStore);
    deviceFlow = (
      provider as unknown as {
        deviceFlow: coreModule.AnthropicDeviceFlow;
      }
    ).deviceFlow;

    (
      deviceFlow as unknown as {
        initiateDeviceFlow: () => Promise<DeviceCodeResponse>;
      }
    ).initiateDeviceFlow = vi.fn(async () => ({
      verification_uri: 'https://console.anthropic.com/oauth/authorize',
      verification_uri_complete:
        'https://claude.ai/oauth/authorize?redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode',
      user_code: 'CODE123',
      device_code: 'device-code',
      expires_in: 1800,
      interval: 5,
    }));
    (deviceFlow as unknown as { getState: () => string }).getState = vi
      .fn()
      .mockReturnValue('generated-state');
    (
      deviceFlow as unknown as {
        buildAuthorizationUrl: (redirectUri: string) => string;
      }
    ).buildAuthorizationUrl = vi
      .fn()
      .mockImplementation(
        (redirectUri: string) =>
          `https://claude.ai/oauth/authorize?redirect_uri=${encodeURIComponent(
            redirectUri,
          )}&code=true`,
      );
    (
      deviceFlow as unknown as {
        exchangeCodeForToken: (authCode: string) => Promise<OAuthToken>;
      }
    ).exchangeCodeForToken = vi.fn(async () => ({
      token_type: 'Bearer' as const,
      access_token: 'local-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      scope: null,
    }));
    vi.spyOn(coreModule, 'openBrowserSecurely').mockImplementation(
      async (url: string) => {
        openBrowserArgs.push(url);
      },
    );
    shouldLaunchBrowserSpy = vi
      .spyOn(coreModule, 'shouldLaunchBrowser')
      .mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (global as { __oauth_needs_code?: boolean }).__oauth_needs_code;
    delete (global as { __oauth_provider?: string }).__oauth_provider;
  });

  it('uses local callback when browser launch is available', async () => {
    const waitForCallback = vi
      .fn()
      .mockResolvedValue({ code: 'auth-code', state: 'generated-state' });
    const shutdown = vi.fn().mockResolvedValue(undefined);

    startLocalOAuthCallbackMock.mockResolvedValue({
      redirectUri: 'http://localhost:8765/callback',
      waitForCallback,
      shutdown,
    });

    await provider.initiateAuth();

    expect(startLocalOAuthCallbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'generated-state' }),
    );
    expect(openBrowserArgs.some((url) => url.includes('localhost'))).toBe(true);
    expect(tokenStore.saveToken).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({ access_token: 'local-token' }),
    );
    // After successful callback, __oauth_needs_code is cleared (false)
    expect(
      (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
    ).toBeFalsy();
    expect(waitForCallback).toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalled();
  });

  it('falls back to manual entry when local callback fails', async () => {
    startLocalOAuthCallbackMock.mockRejectedValue(
      new Error('callback unavailable'),
    );

    shouldLaunchBrowserSpy.mockReturnValue(true);

    const manualPromise = provider.initiateAuth();
    await new Promise((resolve) => setTimeout(resolve, 0));

    provider.cancelAuth();
    await manualPromise.catch(() => undefined);

    expect(startLocalOAuthCallbackMock).toHaveBeenCalled();
    // After cancelAuth(), __oauth_needs_code is cleared (false)
    expect(
      (global as { __oauth_needs_code?: boolean }).__oauth_needs_code,
    ).toBe(false);
  });
});
