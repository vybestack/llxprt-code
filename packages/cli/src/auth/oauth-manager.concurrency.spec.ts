/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for OAuthManager concurrency control and token refresh locking.
 * Related to issue #1151: Prevents concurrent token refreshes across processes.
 */

import { describe, expect, it, vi } from 'vitest';
import { OAuthManager, type OAuthProvider } from './oauth-manager.js';
import type {
  OAuthToken,
  TokenStore,
  Config,
} from '@vybestack/llxprt-code-core';

function makeToken(accessToken: string, expiryOffset = 3600): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiryOffset,
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
      acquireRefreshLock: vi.fn(async () => true),
      releaseRefreshLock: vi.fn(async () => undefined),
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

  describe('Token Refresh Locking (Issue #1151)', () => {
    it('should acquire refresh lock before refreshing expired token', async () => {
      // Given: An expired token
      const expiredToken = makeToken('expired-token', -10);
      const refreshedToken = makeToken('refreshed-token');

      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => expiredToken),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => undefined),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => refreshedToken),
      };
      oauthManager.registerProvider(provider);

      // When: Requesting token that needs refresh
      await oauthManager.getOAuthToken('anthropic');

      // Then: Should acquire lock before refresh
      expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({
          waitMs: 10000,
          staleMs: 30000,
          bucket: undefined,
        }),
      );

      // And: Should release lock after refresh
      expect(tokenStore.releaseRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        undefined,
      );
    });

    it('should re-read token from disk after acquiring lock (double-check pattern)', async () => {
      // Given: An expired token that gets refreshed by another process
      const expiredToken = makeToken('expired-token', -10);
      const alreadyRefreshedToken = makeToken('already-refreshed-token');

      let getTokenCallCount = 0;
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => {
          getTokenCallCount++;
          // First call returns expired token
          // Second call (after lock) returns already-refreshed token
          return getTokenCallCount === 1 ? expiredToken : alreadyRefreshedToken;
        }),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => undefined),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => {
          throw new Error('refreshToken should not be called');
        }),
      };
      oauthManager.registerProvider(provider);

      // When: Requesting token
      const result = await oauthManager.getOAuthToken('anthropic');

      // Then: Should re-read token after acquiring lock
      expect(getTokenCallCount).toBe(2);

      // And: Should use already-refreshed token without calling refreshToken
      expect(result?.access_token).toBe('already-refreshed-token');
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should skip refresh if token is valid after acquiring lock', async () => {
      // Given: A token that expires soon (within 30s)
      const soonToExpireToken = makeToken('soon-to-expire', 20);
      const validToken = makeToken('valid-token', 3600);

      let getTokenCallCount = 0;
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => {
          getTokenCallCount++;
          // First call returns token expiring soon
          // Second call (after lock) returns freshly refreshed valid token
          return getTokenCallCount === 1 ? soonToExpireToken : validToken;
        }),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => undefined),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => {
          throw new Error('refreshToken should not be called');
        }),
      };
      oauthManager.registerProvider(provider);

      // When: Requesting token
      const result = await oauthManager.getOAuthToken('anthropic');

      // Then: Should use valid token without calling refreshToken
      expect(result?.access_token).toBe('valid-token');
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should release lock in finally block even if refresh fails', async () => {
      // Given: An expired token and failing refresh
      const expiredToken = makeToken('expired-token', -10);

      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => expiredToken),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => undefined),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => {
          throw new Error('Refresh failed');
        }),
      };
      oauthManager.registerProvider(provider);

      // When: Requesting token with failing refresh
      const result = await oauthManager.getOAuthToken('anthropic');

      // Then: Should return null
      expect(result).toBeNull();

      // And: Should still release lock
      expect(tokenStore.releaseRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        undefined,
      );
    });

    it('should handle lock timeout by checking disk again', async () => {
      // Given: Lock acquisition fails (timeout)
      const expiredToken = makeToken('expired-token', -10);
      const refreshedByOtherProcess = makeToken('refreshed-by-other', 3600);

      let getTokenCallCount = 0;
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => {
          getTokenCallCount++;
          // First call returns expired token
          // Second call (after lock timeout) returns token refreshed by other process
          return getTokenCallCount === 1
            ? expiredToken
            : refreshedByOtherProcess;
        }),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => false), // Lock timeout
        releaseRefreshLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => undefined),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => {
          throw new Error('refreshToken should not be called');
        }),
      };
      oauthManager.registerProvider(provider);

      // When: Requesting token (lock times out)
      const result = await oauthManager.getOAuthToken('anthropic');

      // Then: Should re-read token from disk after lock timeout
      expect(getTokenCallCount).toBe(2);

      // And: Should return token refreshed by other process
      expect(result?.access_token).toBe('refreshed-by-other');
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should return null if lock timeout and token still expired', async () => {
      // Given: Lock acquisition fails and token still expired
      const expiredToken = makeToken('expired-token', -10);

      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => expiredToken),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => false), // Lock timeout
        releaseRefreshLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => undefined),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => {
          throw new Error('refreshToken should not be called');
        }),
      };
      oauthManager.registerProvider(provider);

      // When: Requesting token (lock times out, token still expired)
      const result = await oauthManager.getOAuthToken('anthropic');

      // Then: Should return null
      expect(result).toBeNull();
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should pass bucket parameter to lock methods', async () => {
      // Given: An expired token for specific bucket
      const expiredToken = makeToken('expired-token', -10);
      const refreshedToken = makeToken('refreshed-token');

      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => expiredToken),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => undefined),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => refreshedToken),
      };
      oauthManager.registerProvider(provider);

      // When: Requesting token for specific bucket
      await oauthManager.getOAuthToken('anthropic', 'test-bucket');

      // Then: Should pass bucket to lock methods
      expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({
          bucket: 'test-bucket',
        }),
      );

      expect(tokenStore.releaseRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        'test-bucket',
      );
    });
  });
});
