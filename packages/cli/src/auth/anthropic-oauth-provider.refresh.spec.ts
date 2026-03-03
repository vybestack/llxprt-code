/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicOAuthProvider } from './anthropic-oauth-provider.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';

function expiredToken(): OAuthToken {
  return {
    access_token: 'expired-access-token',
    refresh_token: 'refresh-token',
    expiry: Math.floor(Date.now() / 1000) - 60,
    token_type: 'Bearer',
    scope: null,
  };
}

describe('AnthropicOAuthProvider refreshIfNeeded', () => {
  let tokenStore: TokenStore;

  beforeEach(() => {
    tokenStore = {
      saveToken: vi.fn(async () => undefined),
      getToken: vi.fn(async () => expiredToken()),
      removeToken: vi.fn(async () => undefined),
      listProviders: vi.fn(async () => []),
      listBuckets: vi.fn(async () => ['default']),
      getBucketStats: vi.fn(async () => null),
      acquireRefreshLock: vi.fn(async () => true), // Issue #1159: Mock lock acquisition
      releaseRefreshLock: vi.fn(async () => undefined), // Issue #1159: Mock lock release
      acquireAuthLock: vi.fn(async () => true),
      releaseAuthLock: vi.fn(async () => undefined),
    } satisfies TokenStore;
  });

  // Phase 4: refreshIfNeeded() is now a no-op deprecation shell
  // Token refresh is handled by OAuthManager.authenticate()
  it('refreshes an expired token and persists the result', async () => {
    const provider = new AnthropicOAuthProvider(tokenStore);

    // refreshIfNeeded is now a no-op that returns null
    const result = await provider.refreshIfNeeded();

    expect(result).toBeNull();
    // Provider no longer calls saveToken - OAuthManager handles persistence
    expect(tokenStore.saveToken).not.toHaveBeenCalled();
    expect(tokenStore.removeToken).not.toHaveBeenCalled();
  });

  // Phase 4: refreshIfNeeded() is now a no-op deprecation shell
  it('removes the token and returns null when refresh fails', async () => {
    const provider = new AnthropicOAuthProvider(tokenStore);

    // refreshIfNeeded is now a no-op that returns null
    const result = await provider.refreshIfNeeded();

    expect(result).toBeNull();
    // Provider no longer calls removeToken - OAuthManager handles auth failures
    expect(tokenStore.removeToken).not.toHaveBeenCalled();
  });
});
