/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #1378: Verify AnthropicOAuthProvider.getToken() does NOT trigger
 * provider-level refresh. OAuthManager owns all refresh operations.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicOAuthProvider } from './anthropic-oauth-provider.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';

function expiredToken(): OAuthToken {
  return {
    access_token: 'expired-access-token',
    refresh_token: 'refresh-token',
    expiry: Math.floor(Date.now() / 1000) - 60, // expired 60s ago
    token_type: 'Bearer',
    scope: null,
  };
}

function validToken(): OAuthToken {
  return {
    access_token: 'valid-access-token',
    refresh_token: 'refresh-token',
    expiry: Math.floor(Date.now() / 1000) + 3600, // valid for 1h
    token_type: 'Bearer',
    scope: null,
  };
}

describe('AnthropicOAuthProvider.getToken() - no provider-level refresh (Issue #1378)', () => {
  let tokenStore: TokenStore;

  beforeEach(() => {
    tokenStore = {
      saveToken: vi.fn(async () => undefined),
      getToken: vi.fn(async () => null),
      removeToken: vi.fn(async () => undefined),
      listProviders: vi.fn(async () => []),
      listBuckets: vi.fn(async () => ['default']),
      getBucketStats: vi.fn(async () => null),
      acquireRefreshLock: vi.fn(async () => true),
      releaseRefreshLock: vi.fn(async () => undefined),
    } satisfies TokenStore;
  });

  it('returns expired token without attempting refresh', async () => {
    const expired = expiredToken();
    vi.mocked(tokenStore.getToken).mockResolvedValue(expired);

    const provider = new AnthropicOAuthProvider(tokenStore);
    const deviceFlow = (
      provider as unknown as {
        deviceFlow: {
          refreshToken: (refreshToken: string) => Promise<OAuthToken>;
        };
      }
    ).deviceFlow;
    deviceFlow.refreshToken = vi.fn(async () => validToken());

    const result = await provider.getToken();

    // getToken() should return the expired token as-is
    expect(result).toEqual(expired);
    // deviceFlow.refreshToken should NOT be called
    expect(deviceFlow.refreshToken).not.toHaveBeenCalled();
    // tokenStore.acquireRefreshLock should NOT be called from getToken()
    expect(tokenStore.acquireRefreshLock).not.toHaveBeenCalled();
    // tokenStore.saveToken should NOT be called from getToken()
    expect(tokenStore.saveToken).not.toHaveBeenCalled();
  });

  it('returns valid token directly from store', async () => {
    const valid = validToken();
    vi.mocked(tokenStore.getToken).mockResolvedValue(valid);

    const provider = new AnthropicOAuthProvider(tokenStore);

    const result = await provider.getToken();

    expect(result).toEqual(valid);
    expect(tokenStore.acquireRefreshLock).not.toHaveBeenCalled();
  });

  it('returns null when no token exists', async () => {
    vi.mocked(tokenStore.getToken).mockResolvedValue(null);

    const provider = new AnthropicOAuthProvider(tokenStore);

    const result = await provider.getToken();

    expect(result).toBeNull();
  });

  it('returns null when no token store is configured', async () => {
    const provider = new AnthropicOAuthProvider(undefined);

    const result = await provider.getToken();

    expect(result).toBeNull();
  });
});
