/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { OAuthManager, type OAuthProvider } from './oauth-manager.js';
import type {
  OAuthToken,
  TokenStore,
  Config,
} from '@vybestack/llxprt-code-core';

function makeToken(accessToken: string): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: '',
  };
}

describe('OAuthManager concurrency', () => {
  it('serializes bucket resolution for concurrent getOAuthToken calls (same provider)', async () => {
    const tokenStore: TokenStore = {
      saveToken: vi.fn(),
      getToken: vi.fn(async (_provider: string, bucket?: string) => {
        if (bucket === 'bucket-a') {
          return makeToken('token-bucket-a');
        }
        return null;
      }),
      removeToken: vi.fn(),
      listProviders: vi.fn(async () => []),
      listBuckets: vi.fn(async () => ['bucket-a', 'bucket-b']),
      getBucketStats: vi.fn(async () => null),
    };

    const oauthManager = new OAuthManager(tokenStore);

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(async () => undefined),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async () => null),
    };
    oauthManager.registerProvider(provider);

    let inProgress = false;
    vi.spyOn(
      oauthManager as unknown as { getProfileBuckets: () => unknown },
      'getProfileBuckets',
    ).mockImplementation(async () => {
      if (inProgress) {
        throw new Error('getProfileBuckets called concurrently');
      }
      inProgress = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      inProgress = false;
      return ['bucket-a', 'bucket-b'];
    });

    let storedFailoverHandler: unknown;
    const config: Pick<
      Config,
      'getBucketFailoverHandler' | 'setBucketFailoverHandler'
    > = {
      getBucketFailoverHandler: vi.fn(() => storedFailoverHandler as never),
      setBucketFailoverHandler: vi.fn((handler) => {
        storedFailoverHandler = handler;
      }),
    };
    oauthManager.setConfigGetter(() => config as unknown as Config);

    const [tokenA, tokenB] = await Promise.all([
      oauthManager.getOAuthToken('anthropic'),
      oauthManager.getOAuthToken('anthropic'),
    ]);

    expect(tokenA?.access_token).toBe('token-bucket-a');
    expect(tokenB?.access_token).toBe('token-bucket-a');
    expect(config.setBucketFailoverHandler).toHaveBeenCalledTimes(1);
  });
});
