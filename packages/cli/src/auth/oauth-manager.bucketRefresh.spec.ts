/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { OAuthManager, type OAuthProvider } from './oauth-manager.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';

function makeToken(accessToken: string, expiresInSeconds: number): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiresInSeconds,
    token_type: 'Bearer',
    scope: '',
  };
}

describe('OAuthManager bucket-aware refresh', () => {
  it('refreshes and persists the expiring token for the requested bucket (no cross-bucket writes)', async () => {
    const expiringBucketToken = makeToken('token-bucket-a', 10);
    const expiringDefaultToken = makeToken('token-default', 10);

    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn(async (_provider: string, bucket?: string) => {
        if (bucket === 'bucket-a') {
          return expiringBucketToken;
        }
        if (bucket === 'default') {
          return expiringDefaultToken;
        }
        return null;
      }),
      removeToken: vi.fn(),
      listProviders: vi.fn(async () => []),
      listBuckets: vi.fn(async () => ['default', 'bucket-a']),
      getBucketStats: vi.fn(async () => null),
    };

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(async () => undefined),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async (currentToken) => ({
        ...currentToken,
        access_token: `refreshed-${currentToken.access_token}`,
        expiry: Math.floor(Date.now() / 1000) + 3600,
      })),
    };

    const manager = new OAuthManager(tokenStore);
    manager.registerProvider(provider);

    const refreshed = await manager.getOAuthToken('anthropic', 'bucket-a');

    expect(refreshed?.access_token).toBe('refreshed-token-bucket-a');
    expect(provider.refreshToken).toHaveBeenCalledWith(expiringBucketToken);

    expect(tokenStore.saveToken).toHaveBeenCalledWith(
      'anthropic',
      expect.objectContaining({ access_token: 'refreshed-token-bucket-a' }),
      'bucket-a',
    );
    expect(tokenStore.saveToken).not.toHaveBeenCalledWith(
      'anthropic',
      expect.anything(),
      'default',
    );
  });
});
