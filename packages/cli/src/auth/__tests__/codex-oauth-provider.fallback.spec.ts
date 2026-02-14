/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../local-oauth-callback.js', () => ({
  startLocalOAuthCallback: vi.fn(),
}));

import * as coreModule from '@vybestack/llxprt-code-core';
import type { TokenStore } from '@vybestack/llxprt-code-core';
import { CodexOAuthProvider } from '../codex-oauth-provider.js';
import { startLocalOAuthCallback } from '../local-oauth-callback.js';

const startLocalOAuthCallbackMock = vi.mocked(startLocalOAuthCallback);

/**
 * Tests for Codex OAuth provider fallback behavior (Issue #828)
 *
 * When the local callback server fails or waitForCallback throws,
 * the provider should fall back to device auth instead of propagating the error.
 */
describe('CodexOAuthProvider fallback behavior', () => {
  let provider: CodexOAuthProvider;
  let mockTokenStore: TokenStore;

  beforeEach(() => {
    vi.spyOn(global.console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    startLocalOAuthCallbackMock.mockReset();

    mockTokenStore = {
      getToken: vi.fn().mockResolvedValue(null),
      saveToken: vi.fn().mockResolvedValue(undefined),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue([]),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
    };

    provider = new CodexOAuthProvider(mockTokenStore);

    // Mock shouldLaunchBrowser to return true (interactive mode)
    vi.spyOn(coreModule, 'shouldLaunchBrowser').mockReturnValue(true);
    vi.spyOn(coreModule, 'openBrowserSecurely').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fall back to device auth when callback fails', async () => {
    // Callback server starts but waitForCallback fails
    const waitForCallback = vi
      .fn()
      .mockRejectedValue(new Error('callback timeout'));
    const shutdown = vi.fn().mockResolvedValue(undefined);

    startLocalOAuthCallbackMock.mockResolvedValue({
      redirectUri: 'http://localhost:1455/auth/callback',
      waitForCallback,
      shutdown,
    });

    // Spy on performDeviceAuth to verify fallback
    const performDeviceAuthSpy = vi
      .spyOn(
        provider as unknown as { performDeviceAuth: () => Promise<void> },
        'performDeviceAuth',
      )
      .mockResolvedValue(undefined);

    await provider.initiateAuth();

    // performDeviceAuth should have been called as fallback
    expect(performDeviceAuthSpy).toHaveBeenCalled();
  });

  it('should not throw when callback server waitForCallback fails', async () => {
    // Callback server starts but waitForCallback rejects
    const waitForCallback = vi
      .fn()
      .mockRejectedValue(new Error('connection refused'));
    const shutdown = vi.fn().mockResolvedValue(undefined);

    startLocalOAuthCallbackMock.mockResolvedValue({
      redirectUri: 'http://localhost:1455/auth/callback',
      waitForCallback,
      shutdown,
    });

    // Spy on performDeviceAuth to prevent actual device auth execution
    vi.spyOn(
      provider as unknown as { performDeviceAuth: () => Promise<void> },
      'performDeviceAuth',
    ).mockResolvedValue(undefined);

    // Should NOT throw - should fall back gracefully
    await expect(provider.initiateAuth()).resolves.toBeUndefined();
  });
});
