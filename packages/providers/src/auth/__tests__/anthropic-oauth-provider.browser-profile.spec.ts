/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../local-oauth-callback.js', () => ({
  startLocalOAuthCallback: vi.fn(),
}));

import * as secureBrowserModule from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';
import type {
  DeviceCodeResponse,
  OAuthToken,
  TokenStore,
} from '@vybestack/llxprt-code-auth';
import { AnthropicOAuthProvider } from '../anthropic-oauth-provider.js';
import { oauthRuntimeBridge } from '../runtime-accessor-bridge.js';
import { startLocalOAuthCallback } from '../local-oauth-callback.js';

const startLocalOAuthCallbackMock = vi.mocked(startLocalOAuthCallback);

/**
 * Minimal TokenStore mock for exercising the provider in isolation.
 */
function createTokenStore(): TokenStore {
  return {
    saveToken: vi.fn<TokenStore['saveToken']>(async () => {}),
    getToken: vi.fn<TokenStore['getToken']>(async () => null),
    removeToken: vi.fn<TokenStore['removeToken']>(async () => undefined),
    listProviders: vi.fn<TokenStore['listProviders']>(async () => []),
    listBuckets: vi.fn<TokenStore['listBuckets']>(async () => ['default']),
    getBucketStats: vi.fn<TokenStore['getBucketStats']>(async () => null),
    acquireRefreshLock: vi.fn(async () => true),
    releaseRefreshLock: vi.fn(async () => undefined),
    acquireAuthLock: vi.fn(async () => true),
    releaseAuthLock: vi.fn(async () => undefined),
  } satisfies TokenStore;
}

/**
 * Wire stubs onto the provider's internal deviceFlow so initiateAuth can run
 * without making network calls.
 */
function stubDeviceFlow(provider: AnthropicOAuthProvider): void {
  const deviceFlow = (
    provider as unknown as {
      deviceFlow: {
        initiateDeviceFlow: () => Promise<DeviceCodeResponse>;
        getState: () => string;
        buildAuthorizationUrl: (redirectUri: string) => string;
        exchangeCodeForToken: (authCode: string) => Promise<OAuthToken>;
      };
    }
  ).deviceFlow;

  deviceFlow.initiateDeviceFlow = vi.fn(async () => ({
    verification_uri: 'https://console.anthropic.com/oauth/authorize',
    verification_uri_complete:
      'https://claude.ai/oauth/authorize?user_code=CODE123',
    user_code: 'CODE123',
    device_code: 'device-code',
    expires_in: 1800,
    interval: 5,
  }));
  deviceFlow.getState = vi.fn().mockReturnValue('generated-state');
  deviceFlow.buildAuthorizationUrl = vi
    .fn()
    .mockImplementation(
      (redirectUri: string) =>
        `https://claude.ai/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
    );
  deviceFlow.exchangeCodeForToken = vi.fn(async () => ({
    token_type: 'Bearer',
    access_token: 'local-token',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    scope: null,
  }));
}

describe('AnthropicOAuthProvider browser profile association', () => {
  let provider: AnthropicOAuthProvider;
  let openBrowserSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(global.console, 'log').mockImplementation(() => {});
    provider = new AnthropicOAuthProvider(createTokenStore());
    stubDeviceFlow(provider);

    openBrowserSpy = vi
      .spyOn(secureBrowserModule, 'openBrowserSecurely')
      .mockResolvedValue(undefined);
    vi.spyOn(secureBrowserModule, 'shouldLaunchBrowser').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    oauthRuntimeBridge.setAccessors(undefined);
    delete (global as { __oauth_needs_code?: boolean }).__oauth_needs_code;
    delete (global as { __oauth_provider?: string }).__oauth_provider;
    delete (global as { __oauth_browser_auth_complete?: boolean })
      .__oauth_browser_auth_complete;
  });

  it('launches the associated browser/profile when an association exists', async () => {
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => undefined,
      getRuntimeContext: () => undefined,
      getCurrentProfileName: () => null,
      getBrowserProfileAssociation: (_provider, _bucket) => ({
        browser: 'chrome',
        profileDirectory: 'Profile 1',
        displayName: 'Work',
      }),
    });

    provider.setAuthContext({ bucket: 'work' });

    startLocalOAuthCallbackMock.mockResolvedValue({
      redirectUri: 'http://localhost:8765/callback',
      waitForCallback: vi
        .fn()
        .mockResolvedValue({ code: 'auth-code', state: 'generated-state' }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    });

    await provider.initiateAuth();

    expect(openBrowserSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        browser: 'chrome',
        profileDirectory: 'Profile 1',
      }),
    );
  });

  it('launches the default browser when no association is set', async () => {
    // No accessors registered → getBrowserProfileAssociation returns undefined
    provider.setAuthContext({ bucket: 'work' });

    startLocalOAuthCallbackMock.mockResolvedValue({
      redirectUri: 'http://localhost:8765/callback',
      waitForCallback: vi
        .fn()
        .mockResolvedValue({ code: 'auth-code', state: 'generated-state' }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    });

    await provider.initiateAuth();

    expect(openBrowserSpy).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  it('falls back to the default browser when the association accessor throws', async () => {
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => undefined,
      getRuntimeContext: () => undefined,
      getCurrentProfileName: () => null,
      getBrowserProfileAssociation: () => {
        throw new Error('store unavailable');
      },
    });

    provider.setAuthContext({ bucket: 'work' });

    startLocalOAuthCallbackMock.mockResolvedValue({
      redirectUri: 'http://localhost:8765/callback',
      waitForCallback: vi
        .fn()
        .mockResolvedValue({ code: 'auth-code', state: 'generated-state' }),
      shutdown: vi.fn().mockResolvedValue(undefined),
    });

    await provider.initiateAuth();

    expect(openBrowserSpy).toHaveBeenCalledWith(expect.any(String), undefined);
  });
});
