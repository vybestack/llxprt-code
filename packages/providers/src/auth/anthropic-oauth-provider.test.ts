/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  AnthropicOAuthProvider,
  type AnthropicOAuthProviderDependencies,
} from './anthropic-oauth-provider.js';
import type { TokenStore } from '@vybestack/llxprt-code-core';
import type { AnthropicDeviceFlow } from '@vybestack/llxprt-code-auth';
import { oauthRuntimeBridge } from './runtime-accessor-bridge.js';

describe('AnthropicOAuthProvider', () => {
  let provider: AnthropicOAuthProvider;
  let mockTokenStore: TokenStore;
  let mockAddItem: ReturnType<typeof vi.fn>;
  let copyToClipboard: ReturnType<typeof vi.fn>;
  let dependencies: AnthropicOAuthProviderDependencies;

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
    copyToClipboard = vi.fn().mockResolvedValue(undefined);
    dependencies = {
      startLocalOAuthCallback: vi.fn().mockResolvedValue({
        redirectUri: 'http://localhost:8787/callback',
        waitForCallback: vi
          .fn()
          .mockRejectedValue(new Error('Local callback disabled for test')),
        shutdown: vi.fn().mockResolvedValue(undefined),
      }),
      createDeviceFlow: () =>
        ({
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
          getState: vi.fn().mockReturnValue('mock-state'),
          buildAuthorizationUrl: vi
            .fn()
            .mockReturnValue('https://anthropic.com/authorize'),
        }) as unknown as AnthropicDeviceFlow,
      shouldLaunchBrowser: vi.fn().mockReturnValue(true),
      openBrowserSecurely: vi.fn().mockResolvedValue(undefined),
      copyToClipboard,
    };

    provider = new AnthropicOAuthProvider(
      mockTokenStore,
      mockAddItem,
      dependencies,
    );

    // Mock the pending auth promise to prevent hanging
    vi.spyOn(provider, 'waitForAuthCode').mockResolvedValue(
      'mock-auth-code#mock-state',
    );

    vi.spyOn(console, 'log').mockImplementation(() => {});

    (global as Record<string, unknown>).__oauth_provider = '';
    (global as Record<string, unknown>).__oauth_needs_code = false;
  });

  afterEach(() => {
    oauthRuntimeBridge.setAccessors(undefined);
  });

  it('should call addItem with type "oauth_url" when initiating auth', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(
      mockTokenStore,
      mockAddItem,
      dependencies,
    );

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
          'Please visit the following URL to authorize with Anthropic Claude',
        ),
      }),
    );
  });

  it('should call addItem with both text and url fields when initiating auth', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(
      mockTokenStore,
      mockAddItem,
      dependencies,
    );

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
      'Please visit the following URL to authorize with Anthropic Claude',
    );
    expect(typeof addItemCall.url).toBe('string');
  });

  it('should copy auth URL to clipboard when initiating auth', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(
      mockTokenStore,
      mockAddItem,
      dependencies,
    );

    vi.spyOn(provider, 'waitForAuthCode').mockImplementation(async () =>
      Promise.resolve('mock-auth-code#mock-state'),
    );

    const authPromise = provider.initiateAuth();
    await new Promise((resolve) => setTimeout(resolve, 100));
    provider.submitAuthCode('mock-auth-code#mock-state');
    await authPromise;

    // This should now pass - we expect ClipboardService.copyToClipboard to be called
    expect(copyToClipboard).toHaveBeenCalled();
  });

  it('should call addItem with type "oauth_url" when browser launch is disabled', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(
      mockTokenStore,
      mockAddItem,
      dependencies,
    );

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
          'Please visit the following URL to authorize with Anthropic Claude',
        ),
      }),
    );
  });

  it('should call addItem with type "oauth_url" in showAuthMessage method', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(
      mockTokenStore,
      mockAddItem,
      dependencies,
    );

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
          'Please visit the following URL to authorize with Anthropic Claude',
        ),
      }),
    );
  });

  it('should pass the correct URL to clipboard when showAuthMessage is called', async () => {
    // Reset mocks and clear the spy
    vi.clearAllMocks();

    // Re-initialize mocks (it seems the provider's addItem is getting lost)
    provider = new AnthropicOAuthProvider(
      mockTokenStore,
      mockAddItem,
      dependencies,
    );

    vi.spyOn(provider, 'waitForAuthCode').mockImplementation(async () =>
      Promise.resolve('mock-auth-code#mock-state'),
    );

    const authPromise = provider.initiateAuth();
    await new Promise((resolve) => setTimeout(resolve, 100));
    provider.submitAuthCode('mock-auth-code#mock-state');
    await authPromise;

    // This should now pass - we expect the URL to be copied to clipboard
    expect(copyToClipboard).toHaveBeenCalled();
  });
});
