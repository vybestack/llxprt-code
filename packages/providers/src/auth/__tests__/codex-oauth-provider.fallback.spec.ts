/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as coreModule from '@vybestack/llxprt-code-core';
import type { TokenStore } from '@vybestack/llxprt-code-core';
import { CodexOAuthProvider } from '../codex-oauth-provider.js';
import type { startLocalOAuthCallback } from '../local-oauth-callback.js';

describe('CodexOAuthProvider fallback behavior', () => {
  let provider: CodexOAuthProvider;
  let mockTokenStore: TokenStore;
  let startLocalCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(global.console, 'log').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    startLocalCallback = vi.fn();

    mockTokenStore = {
      getToken: vi.fn().mockResolvedValue(null),
      saveToken: vi.fn().mockResolvedValue(undefined),
      removeToken: vi.fn().mockResolvedValue(undefined),
      listProviders: vi.fn().mockResolvedValue([]),
      listBuckets: vi.fn().mockResolvedValue([]),
      getBucketStats: vi.fn().mockResolvedValue(null),
      acquireRefreshLock: vi.fn().mockResolvedValue(true),
      releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
      acquireAuthLock: vi.fn(async () => true),
      releaseAuthLock: vi.fn(async () => undefined),
    };

    provider = new CodexOAuthProvider(
      mockTokenStore,
      undefined,
      startLocalCallback as typeof startLocalOAuthCallback,
    );

    vi.spyOn(coreModule, 'shouldLaunchBrowser').mockReturnValue(true);
    vi.spyOn(coreModule, 'openBrowserSecurely').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fall back to device auth when callback fails', async () => {
    const waitForCallback = vi
      .fn()
      .mockRejectedValue(new Error('callback timeout'));
    const shutdown = vi.fn().mockResolvedValue(undefined);

    startLocalCallback.mockResolvedValue({
      redirectUri: 'http://localhost:1455/auth/callback',
      waitForCallback,
      shutdown,
    });

    const performDeviceAuthSpy = vi
      .spyOn(
        provider as unknown as { performDeviceAuth: () => Promise<void> },
        'performDeviceAuth',
      )
      .mockResolvedValue(undefined);

    await provider.initiateAuth();

    expect(performDeviceAuthSpy).toHaveBeenCalled();
  });

  it('should not throw when callback server waitForCallback fails', async () => {
    const waitForCallback = vi
      .fn()
      .mockRejectedValue(new Error('connection refused'));
    const shutdown = vi.fn().mockResolvedValue(undefined);

    startLocalCallback.mockResolvedValue({
      redirectUri: 'http://localhost:1455/auth/callback',
      waitForCallback,
      shutdown,
    });

    vi.spyOn(
      provider as unknown as { performDeviceAuth: () => Promise<void> },
      'performDeviceAuth',
    ).mockResolvedValue(undefined);

    expect(await provider.initiateAuth()).toBeUndefined();
  });
});
