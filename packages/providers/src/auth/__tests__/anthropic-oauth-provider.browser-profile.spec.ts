/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { BrowserLaunchOptions } from '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js';

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
 * The slice of the provider's internal device flow that initiateAuth drives.
 * Defined here (test-only) so the cast below is checked against a documented
 * contract rather than an untyped `any`. Direct internal access is required
 * because the public API would make real network calls; these stubs let the
 * auth orchestration run end-to-end without touching the network.
 */
interface DeviceFlowTestHarness {
  initiateDeviceFlow: () => Promise<DeviceCodeResponse>;
  getState: () => string;
  buildAuthorizationUrl: (redirectUri: string) => string;
  exchangeCodeForToken: (authCode: string) => Promise<OAuthToken>;
}

/**
 * Wire stubs onto the provider's internal deviceFlow so initiateAuth can run
 * without making network calls.
 */
function stubDeviceFlow(provider: AnthropicOAuthProvider): void {
  const deviceFlow = (
    provider as unknown as { deviceFlow: DeviceFlowTestHarness }
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

const LOCAL_CALLBACK_REDIRECT_URI = 'http://localhost:8765/callback';
const LOCAL_CALLBACK_REDIRECT_URI_FRAGMENT = `redirect_uri=${encodeURIComponent(
  LOCAL_CALLBACK_REDIRECT_URI,
)}`;

function configureSuccessfulLocalCallback(): void {
  startLocalOAuthCallbackMock.mockResolvedValue({
    redirectUri: LOCAL_CALLBACK_REDIRECT_URI,
    waitForCallback: vi
      .fn()
      .mockResolvedValue({ code: 'auth-code', state: 'generated-state' }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  });
}

function clearOAuthGlobals(): void {
  delete (global as { __oauth_needs_code?: boolean }).__oauth_needs_code;
  delete (global as { __oauth_provider?: string }).__oauth_provider;
  delete (global as { __oauth_browser_auth_complete?: boolean })
    .__oauth_browser_auth_complete;
  delete (global as { __oauth_auth_complete?: boolean }).__oauth_auth_complete;
}

function expectBrowserLaunch(
  openBrowserSpy: ReturnType<typeof vi.spyOn>,
  options: BrowserLaunchOptions | undefined,
): void {
  expect(openBrowserSpy).toHaveBeenCalledWith(
    expect.stringContaining(LOCAL_CALLBACK_REDIRECT_URI_FRAGMENT),
    options === undefined ? undefined : expect.objectContaining(options),
  );
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
    clearOAuthGlobals();
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

    configureSuccessfulLocalCallback();

    const result = await provider.initiateAuth();

    expect(result).toStrictEqual(
      expect.objectContaining({ token_type: 'Bearer' }),
    );
    expectBrowserLaunch(openBrowserSpy, {
      browser: 'chrome',
      profileDirectory: 'Profile 1',
    });
  });

  it('launches the default browser when no association is set', async () => {
    // No accessors registered → getBrowserProfileAssociation returns undefined
    provider.setAuthContext({ bucket: 'work' });

    configureSuccessfulLocalCallback();

    const result = await provider.initiateAuth();

    expect(result).toStrictEqual(
      expect.objectContaining({ token_type: 'Bearer' }),
    );
    expectBrowserLaunch(openBrowserSpy, undefined);
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

    configureSuccessfulLocalCallback();

    const result = await provider.initiateAuth();

    expect(result).toStrictEqual(
      expect.objectContaining({ token_type: 'Bearer' }),
    );
    expectBrowserLaunch(openBrowserSpy, undefined);
  });

  it('does not launch a browser when shouldLaunchBrowser returns false (headless/CI)', async () => {
    vi.spyOn(secureBrowserModule, 'shouldLaunchBrowser').mockReturnValue(false);
    provider.setAuthContext({ bucket: 'work' });

    // In headless mode the flow blocks on manual code entry. Replace the dialog
    // setup with a resolved promise so the test does not install a real timeout.
    const providerInternals = provider as unknown as {
      armPendingAuthDialog: () => void;
      pendingAuthPromise?: Promise<string>;
    };
    vi.spyOn(providerInternals, 'armPendingAuthDialog').mockImplementation(
      () => {
        providerInternals.pendingAuthPromise = Promise.resolve('manual-code');
      },
    );

    const result = await provider.initiateAuth();

    expect(result).toStrictEqual(
      expect.objectContaining({ token_type: 'Bearer' }),
    );
    expect(openBrowserSpy).not.toHaveBeenCalled();
  });

  it('tolerates a browser launch failure and still completes auth (graceful degradation)', async () => {
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
    openBrowserSpy.mockRejectedValue(new Error('spawn chrome ENOENT'));
    provider.setAuthContext({ bucket: 'work' });

    configureSuccessfulLocalCallback();

    const result = await provider.initiateAuth();

    expect(result).toStrictEqual(
      expect.objectContaining({ token_type: 'Bearer' }),
    );
    expectBrowserLaunch(openBrowserSpy, {
      browser: 'chrome',
      profileDirectory: 'Profile 1',
    });
  });
});
