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
    } satisfies TokenStore;
  });

  it('refreshes an expired token and persists the result', async () => {
    const provider = new AnthropicOAuthProvider(tokenStore);
    const deviceFlow = (
      provider as unknown as {
        deviceFlow: {
          refreshToken: (refreshToken: string) => Promise<OAuthToken>;
        };
      }
    ).deviceFlow;

    const refreshedToken: OAuthToken = {
      access_token: 'refreshed-access-token',
      refresh_token: 'refreshed-refresh-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
      scope: null,
    };

    deviceFlow.refreshToken = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return refreshedToken;
    });

    const result = await provider.refreshIfNeeded();

    expect(result).toEqual(refreshedToken);
    expect(tokenStore.saveToken).toHaveBeenCalledWith(
      'anthropic',
      refreshedToken,
    );
    expect(tokenStore.removeToken).not.toHaveBeenCalled();
  });

  it('removes the token and returns null when refresh fails', async () => {
    const provider = new AnthropicOAuthProvider(tokenStore);
    const deviceFlow = (
      provider as unknown as {
        deviceFlow: {
          refreshToken: (refreshToken: string) => Promise<OAuthToken>;
        };
      }
    ).deviceFlow;

    deviceFlow.refreshToken = vi.fn(async () => {
      throw new Error('refresh failed');
    });

    const result = await provider.refreshIfNeeded();

    expect(result).toBeNull();
    expect(tokenStore.removeToken).toHaveBeenCalledWith('anthropic');
  });
});
