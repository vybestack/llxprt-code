/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'bun:test';
import { AnthropicOAuthProvider } from './anthropic-oauth-provider.js';
import type { TokenStore } from '@vybestack/llxprt-code-core';

// Mock the ClipboardService class - do this before importing it
const realSecureBrowserLauncherModule = {
  ...(await import(
    '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js'
  )),
};
const realLlxprtCodeAuthModule = {
  ...(await import('@vybestack/llxprt-code-auth')),
};

void vi.mock('./ClipboardService.js', () => ({
  ClipboardService: {
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import the mocked ClipboardService for test assertions
import { ClipboardService } from './ClipboardService.js';

// Register real runtime accessors via the bridge (no mock theater)
import { oauthRuntimeBridge } from './runtime-accessor-bridge.js';

// Mock the device flow implementation
void vi.mock(
  '@vybestack/llxprt-code-core/utils/secure-browser-launcher.js',
  () => {
    const actual = realSecureBrowserLauncherModule;
    return {
      ...actual,
      // Mock shouldLaunchBrowser to return true for tests
      shouldLaunchBrowser: vi.fn().mockReturnValue(true),
      // Mock openBrowserSecurely to prevent actual browser opening
      openBrowserSecurely: vi.fn().mockResolvedValue(undefined),
    };
  },
);

void vi.mock('@vybestack/llxprt-code-auth', () => {
  const actual = realLlxprtCodeAuthModule;
  return {
    ...actual,
    AnthropicDeviceFlow: vi.fn().mockImplementation(() => ({
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'mock-device-code',
        user_code: 'mock-user-code',
        verification_uri: 'https://anthropic.com/authorize',
        verification_uri_complete:
          'https://anthropic.com/authorize?user_code=mock-user-code',
      }),
      exchangeCodeForToken: vi.fn().mockResolvedValue({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
        scope: 'openid profile email',
      }),
    })),
  };
});

describe('AnthropicOAuthProvider', () => {
  let provider: AnthropicOAuthProvider;
  let mockTokenStore: { [K in keyof TokenStore]: Mock<TokenStore[K]> };
  let mockAddItem: Mock<(...args: never[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Register runtime accessors with defaults (getEphemeralSetting → undefined)
    oauthRuntimeBridge.setAccessors({
      getEphemeralSetting: () => undefined,
      getProviderManager: () => undefined,
      getRuntimeContext: () => undefined,
      getCurrentProfileName: () => null,
    });

    mockTokenStore = {
      getToken: vi.fn().mockResolvedValue(null),
      saveToken: vi.fn().mockResolvedValue(undefined),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue(['default']),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn().mockResolvedValue(true),
      releaseAuthLock: vi.fn().mockResolvedValue(undefined),
    };

    mockAddItem = vi.fn();

    provider = new AnthropicOAuthProvider(mockTokenStore, mockAddItem);

    // Mock the pending auth promise to prevent hanging
    vi.spyOn(provider, 'waitForAuthCode').mockResolvedValue(
      'mock-auth-code#mock-state',
    );

    // Mock console.log to prevent output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock local OAuth callback to prevent actual server startup
    void vi.mock('./local-oauth-callback.js', () => ({
      startLocalOAuthCallback: vi.fn().mockResolvedValue({
        redirectUri: 'http://localhost:8787/callback',
        waitForCallback: vi
          .fn()
          .mockRejectedValue(new Error('Local callback disabled for test')),
        shutdown: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    // Mock the pending auth promise to prevent hanging
    vi.spyOn(provider, 'waitForAuthCode').mockResolvedValue(
      'mock-auth-code#mock-state',
    );

    // Mock the global object variables used by OAuth
    (global as Record<string, unknown>).__oauth_provider = '';
    (global as Record<string, unknown>).__oauth_needs_code = false;

    // Mock ClipboardService - make sure to clear any previous calls
    (
      ClipboardService.copyToClipboard as Mock<
        typeof ClipboardService.copyToClipboard
      >
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    oauthRuntimeBridge.setAccessors(undefined);
  });

  it('should call addItem with type "oauth_url" when initiating auth', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(mockTokenStore, mockAddItem);

    // Mock the pending auth promise to prevent hanging - need to call submitAuthCode
    vi.spyOn(provider, 'waitForAuthCode').mockImplementation(async () =>
      // Immediately resolve with the auth code
      Promise.resolve('mock-auth-code#mock-state'),
    );

    // Mock initiateAuth but only partially - just check the first part
    const authPromise = provider.initiateAuth();

    // Wait a bit for addItem to be called
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now submit the auth code to unblock the promise
    provider.submitAuthCode('mock-auth-code#mock-state');

    // Wait for the auth to complete
    await authPromise;

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'oauth_url', // Now expecting 'oauth_url' type
        text: expect.stringContaining(
          'Please visit the following URL to authorize with Claude Code',
        ),
      }),
    );
  });

  it('should call addItem with both text and url fields when initiating auth', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(mockTokenStore, mockAddItem);

    // Mock the pending auth promise to prevent hanging - need to call submitAuthCode
    vi.spyOn(provider, 'waitForAuthCode').mockImplementation(async () =>
      Promise.resolve('mock-auth-code#mock-state'),
    );

    const authPromise = provider.initiateAuth();
    await new Promise((resolve) => setTimeout(resolve, 100));
    provider.submitAuthCode('mock-auth-code#mock-state');
    await authPromise;

    const addItemCall = mockAddItem.mock.calls[0][0];
    expect(addItemCall).toHaveProperty('text');
    // This should now pass - we expect the item to have a url property
    expect(addItemCall).toHaveProperty('url');
    expect(addItemCall.text).toContain(
      'Please visit the following URL to authorize with Claude Code',
    );
    expect(typeof addItemCall.url).toBe('string');
  });

  it('should copy auth URL to clipboard when initiating auth', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(mockTokenStore, mockAddItem);

    vi.spyOn(provider, 'waitForAuthCode').mockImplementation(async () =>
      Promise.resolve('mock-auth-code#mock-state'),
    );

    const authPromise = provider.initiateAuth();
    await new Promise((resolve) => setTimeout(resolve, 100));
    provider.submitAuthCode('mock-auth-code#mock-state');
    await authPromise;

    // This should now pass - we expect ClipboardService.copyToClipboard to be called
    expect(ClipboardService.copyToClipboard).toHaveBeenCalled();
  });

  it('should call addItem with type "oauth_url" when browser launch is disabled', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(mockTokenStore, mockAddItem);

    vi.spyOn(provider, 'waitForAuthCode').mockImplementation(async () =>
      Promise.resolve('mock-auth-code#mock-state'),
    );

    const authPromise = provider.initiateAuth();
    await new Promise((resolve) => setTimeout(resolve, 100));
    provider.submitAuthCode('mock-auth-code#mock-state');
    await authPromise;

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'oauth_url', // Now expecting 'oauth_url' type
        text: expect.stringContaining(
          'Please visit the following URL to authorize with Claude Code',
        ),
      }),
    );
  });

  it('should call addItem with type "oauth_url" in showAuthMessage method', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(mockTokenStore, mockAddItem);

    vi.spyOn(provider, 'waitForAuthCode').mockImplementation(async () =>
      Promise.resolve('mock-auth-code#mock-state'),
    );

    const authPromise = provider.initiateAuth();
    await new Promise((resolve) => setTimeout(resolve, 100));
    provider.submitAuthCode('mock-auth-code#mock-state');
    await authPromise;

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'oauth_url', // Now expecting 'oauth_url' type
        text: expect.stringContaining(
          'Please visit the following URL to authorize with Claude Code',
        ),
      }),
    );
  });

  it('should pass the correct URL to clipboard when showAuthMessage is called', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(mockTokenStore, mockAddItem);

    vi.spyOn(provider, 'waitForAuthCode').mockImplementation(async () =>
      Promise.resolve('mock-auth-code#mock-state'),
    );

    const authPromise = provider.initiateAuth();
    await new Promise((resolve) => setTimeout(resolve, 100));
    provider.submitAuthCode('mock-auth-code#mock-state');
    await authPromise;

    // This should now pass - we expect the URL to be copied to clipboard
    expect(ClipboardService.copyToClipboard).toHaveBeenCalled();
  });

  describe('claudecode identity (@issue:2274)', () => {
    it('exposes claudecode as its public runtime identity name', () => {
      expect(provider.name).toBe('claudecode');
    });

    it('requests the TokenStore under the exact key claudecode during initialization', async () => {
      mockTokenStore.getToken.mockResolvedValue(null);

      await provider.initializeToken();

      expect(mockTokenStore.getToken).toHaveBeenCalledWith('claudecode');
    });

    it('reads the stored token under the exact key claudecode via getToken()', async () => {
      const expectedToken = {
        accessToken: 'stored-access',
        refreshToken: 'stored-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      } as const;
      mockTokenStore.getToken.mockResolvedValue(expectedToken);

      const token = await provider.getToken();

      expect(mockTokenStore.getToken).toHaveBeenCalledWith('claudecode');
      expect(token).toStrictEqual(expectedToken);
    });
  });
});
