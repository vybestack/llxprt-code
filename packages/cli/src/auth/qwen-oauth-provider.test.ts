/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QwenOAuthProvider } from './qwen-oauth-provider.js';
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
    QwenDeviceFlow: vi.fn().mockImplementation(() => ({
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'mock-device-code',
        user_code: 'mock-user-code',
        verification_uri: 'https://chat.qwen.ai/activate',
        verification_uri_complete:
          'https://chat.qwen.ai/activate?user_code=mock-user-code',
      }),
      pollForToken: vi.fn().mockResolvedValue({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
        scope: 'openid profile email model.completion',
      }),
    })),
    // Mock shouldLaunchBrowser to return true for tests
    shouldLaunchBrowser: vi.fn().mockReturnValue(true),
    // Mock openBrowserSecurely to prevent actual browser opening
    openBrowserSecurely: vi.fn().mockResolvedValue(undefined),
  };
});

describe('QwenOAuthProvider', () => {
  let provider: QwenOAuthProvider;
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

    provider = new QwenOAuthProvider(mockTokenStore, mockAddItem);

    // Mock console.log to prevent output during tests
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock ClipboardService - make sure to clear any previous calls
    vi.mocked(ClipboardService.copyToClipboard).mockResolvedValue(undefined);
  });

  it('should call addItem with type "oauth_url" when initiating auth', async () => {
    await provider.initiateAuth();

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'oauth_url', // Now expecting 'oauth_url' type
        text: expect.stringContaining(
          'Please visit the following URL to authorize with Qwen',
        ),
      }),
      expect.any(Number),
    );
  });

  it('should call addItem with both text and url fields when initiating auth', async () => {
    await provider.initiateAuth();

    const addItemCall = mockAddItem.mock.calls[0][0];
    expect(addItemCall).toHaveProperty('text');
    // This should now pass - we expect the item to have a url property
    expect(addItemCall).toHaveProperty('url');
    expect(addItemCall.text).toContain(
      'Please visit the following URL to authorize with Qwen',
    );
    expect(addItemCall.url).toBe(
      'https://chat.qwen.ai/activate?user_code=mock-user-code',
    );
  });

  it('should copy auth URL to clipboard when initiating auth', async () => {
    await provider.initiateAuth();

    // This should now pass - we expect ClipboardService.copyToClipboard to be called
    expect(ClipboardService.copyToClipboard).toHaveBeenCalledWith(
      'https://chat.qwen.ai/activate?user_code=mock-user-code',
    );
  });

  it('should call addItem with type "oauth_url" when browser launch is disabled', async () => {
    // Mock shouldLaunchBrowser to return false
    vi.doMock('@vybestack/llxprt-code-core', async () => {
      const actual = await vi.importActual('@vybestack/llxprt-code-core');
      return {
        ...actual,
        shouldLaunchBrowser: vi.fn().mockReturnValue(false),
      };
    });

    await provider.initiateAuth();

    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'oauth_url', // Now expecting 'oauth_url' type
        text: expect.stringContaining(
          'Please visit the following URL to authorize with Qwen',
        ),
      }),
      expect.any(Number),
    );
  });
});
