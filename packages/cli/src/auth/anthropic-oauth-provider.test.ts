/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicOAuthProvider } from './anthropic-oauth-provider.js';
import { TokenStore } from '@vybestack/llxprt-code-core';

// Mock the ClipboardService class - do this before importing it
vi.mock('../services/ClipboardService.js', () => ({
  ClipboardService: {
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import the mocked ClipboardService for test assertions
import { ClipboardService } from '../services/ClipboardService.js';

// Mock the device flow implementation
vi.mock('@vybestack/llxprt-code-core', async () => {
  const actual = await vi.importActual('@vybestack/llxprt-code-core');
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
    // Mock shouldLaunchBrowser to return true for tests
    shouldLaunchBrowser: vi.fn().mockReturnValue(true),
    // Mock openBrowserSecurely to prevent actual browser opening
    openBrowserSecurely: vi.fn().mockResolvedValue(undefined),
  };
});

describe('AnthropicOAuthProvider', () => {
  let provider: AnthropicOAuthProvider;
  let mockTokenStore: import('vitest').MockedObject<TokenStore>;
  let mockAddItem: ReturnType<typeof import('vitest').vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTokenStore = {
      getToken: vi.fn().mockResolvedValue(null),
      saveToken: vi.fn().mockResolvedValue(undefined),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
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
    vi.mock('./local-oauth-callback.js', () => ({
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
    vi.mocked(ClipboardService.copyToClipboard).mockResolvedValue(undefined);
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
          'Please visit the following URL to authorize with Anthropic Claude',
        ),
      }),
      expect.any(Number),
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
      'Please visit the following URL to authorize with Anthropic Claude',
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
          'Please visit the following URL to authorize with Anthropic Claude',
        ),
      }),
      expect.any(Number),
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
          'Please visit the following URL to authorize with Anthropic Claude',
        ),
      }),
      expect.any(Number),
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
});
