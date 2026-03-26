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

function validToken(): OAuthToken {
  return {
    access_token: 'refreshed-access-token',
    refresh_token: 'refresh-token',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: null,
  };
}

describe('AnthropicOAuthProvider refreshToken', () => {
  let tokenStore: TokenStore;

  beforeEach(() => {
    tokenStore = {
      saveToken: vi.fn(async () => undefined),
      getToken: vi.fn(async () => expiredToken()),
      removeToken: vi.fn(async () => undefined),
      listProviders: vi.fn(async () => []),
      listBuckets: vi.fn(async () => ['default']),
      getBucketStats: vi.fn(async () => null),
      acquireRefreshLock: vi.fn(async () => true),
      releaseRefreshLock: vi.fn(async () => undefined),
      acquireAuthLock: vi.fn(async () => true),
      releaseAuthLock: vi.fn(async () => undefined),
    } satisfies TokenStore;
  });

  it('returns refreshed token without writing to tokenStore directly', async () => {
    const provider = new AnthropicOAuthProvider(tokenStore);

    const deviceFlow = (
      provider as unknown as {
        deviceFlow: { refreshToken: (rt: string) => Promise<OAuthToken> };
      }
    ).deviceFlow;
    deviceFlow.refreshToken = vi.fn(async () => validToken());

    const expired = expiredToken();
    const result = await provider.refreshToken(expired);

    expect(result).not.toBeNull();
    expect(result?.access_token).toBe('refreshed-access-token');
    // Provider does not call saveToken — OAuthManager handles persistence
    expect(tokenStore.saveToken).not.toHaveBeenCalled();
    expect(tokenStore.removeToken).not.toHaveBeenCalled();
  });

  it('returns null when token has no valid refresh_token', async () => {
    const provider = new AnthropicOAuthProvider(tokenStore);

    const noRefreshToken: OAuthToken = {
      access_token: 'access',
      refresh_token: undefined,
      expiry: Math.floor(Date.now() / 1000) - 60,
      token_type: 'Bearer',
      scope: null,
    };

    const result = await provider.refreshToken(noRefreshToken);

    expect(result).toBeNull();
    expect(tokenStore.saveToken).not.toHaveBeenCalled();
    expect(tokenStore.removeToken).not.toHaveBeenCalled();
  });
});
