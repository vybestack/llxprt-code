/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for OAuthManager auth lock and TOCTOU defense
 * Related to issue #1652: Prevents concurrent authentication and token contamination
 */

import { describe, expect, it, vi } from 'vitest';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider } from './types.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';

// Mock runtime settings to avoid MissingProviderRuntimeError
vi.mock('../runtime/runtimeSettings.js', () => ({
  getCliRuntimeServices: vi.fn(() => ({
    config: undefined,
    settings: undefined,
  })),
  getEphemeralSetting: vi.fn((key: string) => {
    if (key === 'auth-bucket-delay') {
      return 0;
    }
    return undefined;
  }),
  getCliProviderManager: vi.fn(() => undefined),
  getCliRuntimeContext: vi.fn(() => undefined),
}));

function makeToken(accessToken: string, expiryOffset = 3600): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiryOffset,
    token_type: 'Bearer' as const,
    scope: '',
  };
}

describe('OAuthManager auth lock and TOCTOU defense (Issue #1652)', () => {
  describe('Phase 5: TOCTOU Defense', () => {
    /**
     * Test 5.1: Cross-process auth skipped in onAuthBucket
     * GIVEN authenticateMultipleBuckets() with 2 buckets (default, claudius)
     * AND default was unauthenticated at upfront check time
     * AND another process writes a valid token for default between upfront check and onAuthBucket execution
     * WHEN onAuthBucket runs for default
     * THEN authenticate() is NOT called for default (token appeared cross-process)
     * AND authenticate() IS called for claudius
     */
    it('Test 5.1: should skip cross-process authenticated bucket in onAuthBucket', async () => {
      let getTokenCallCount = 0;
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async (_provider: string, bucket?: string) => {
          getTokenCallCount++;
          // Simulate cross-process write:
          // First call (upfront check for default): returns null (unauthenticated)
          // Second call (upfront check for claudius): returns null
          // Third call (onAuthBucket re-check for default): returns valid token (cross-process wrote it!)
          // Fourth call (onAuthBucket re-check for claudius): returns null
          if (getTokenCallCount === 1 && bucket === 'default') {
            return null; // Upfront check: not authenticated yet
          }
          if (getTokenCallCount === 2 && bucket === 'claudius') {
            return null; // Upfront check: not authenticated yet
          }
          if (getTokenCallCount === 3 && bucket === 'default') {
            return makeToken('cross-process-token-default'); // Cross-process wrote it!
          }
          if (getTokenCallCount === 4 && bucket === 'claudius') {
            return null; // Still needs auth
          }
          return null;
        }),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const authenticateCalls: Array<{ provider: string; bucket?: string }> =
        [];

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => {
          throw new Error('initiateAuth should not be called for default');
        }),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      // Spy on authenticate to track calls
      const authenticateSpy = vi
        .spyOn(oauthManager, 'authenticate')
        .mockImplementation(async (providerName: string, bucket?: string) => {
          authenticateCalls.push({ provider: providerName, bucket });
        });

      await oauthManager.authenticateMultipleBuckets('anthropic', [
        'default',
        'claudius',
      ]);

      // authenticate() should NOT be called for default (cross-process token found)
      // authenticate() SHOULD be called for claudius
      expect(authenticateCalls).toHaveLength(1);
      expect(authenticateCalls[0]).toEqual({
        provider: 'anthropic',
        bucket: 'claudius',
      });

      // Verify getToken was called for both upfront checks and both TOCTOU re-checks
      expect(getTokenCallCount).toBe(4);

      authenticateSpy.mockRestore();
    });

    /**
     * Test 5.2: Upfront filter still reduces prompts
     * GIVEN authenticateMultipleBuckets() with 3 buckets (default, claudius, vybestack)
     * AND default already has a valid token
     * WHEN the method runs
     * THEN default is filtered out in the upfront check
     * AND only claudius and vybestack go through the auth flow
     */
    it('Test 5.2: should filter out already-authenticated buckets in upfront check', async () => {
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async (_provider: string, bucket?: string) => {
          if (bucket === 'default') {
            return makeToken('existing-default-token'); // Already authenticated
          }
          return null; // claudius and vybestack need auth
        }),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const authenticateCalls: Array<{ provider: string; bucket?: string }> =
        [];

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => makeToken('new-token')),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      const authenticateSpy = vi
        .spyOn(oauthManager, 'authenticate')
        .mockImplementation(async (providerName: string, bucket?: string) => {
          authenticateCalls.push({ provider: providerName, bucket });
        });

      await oauthManager.authenticateMultipleBuckets('anthropic', [
        'default',
        'claudius',
        'vybestack',
      ]);

      // default should be filtered out upfront (already authenticated)
      // Only claudius and vybestack should go through auth flow
      expect(authenticateCalls).toHaveLength(2);
      expect(authenticateCalls).toContainEqual({
        provider: 'anthropic',
        bucket: 'claudius',
      });
      expect(authenticateCalls).toContainEqual({
        provider: 'anthropic',
        bucket: 'vybestack',
      });

      authenticateSpy.mockRestore();
    });
  });

  describe('Phase 5: Regression Tests', () => {
    /**
     * Test 5.3: Single-bucket profile unchanged
     * GIVEN a profile with auth.type = oauth and no buckets array
     * WHEN getToken for anthropic is called
     * THEN behavior uses default bucket, auth triggered if needed
     */
    it('Test 5.3: should use default bucket for single-bucket profile', async () => {
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => null),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => false), // No refresh needed
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => makeToken('new-token')),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      // Enable OAuth for the provider (must be done after registerProvider)
      // Use the mock TokenStore to simulate settings that enable OAuth
      vi.spyOn(oauthManager, 'isOAuthEnabled').mockReturnValue(true);

      // Stub getProfileBuckets to return single bucket (default behavior)
      vi.spyOn(
        oauthManager as unknown as { getProfileBuckets: () => unknown },
        'getProfileBuckets',
      ).mockResolvedValue(['default']);

      await oauthManager.authenticate('anthropic');

      // Should save with default bucket (undefined bucket parameter)
      expect(tokenStore.saveToken).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({ access_token: 'new-token' }),
        undefined,
      );
    });

    /**
     * Test 5.4: Non-OAuth flows unchanged
     * GIVEN a profile with auth.type = key (API key)
     * WHEN getToken() is called
     * THEN OAuth flow is NOT triggered
     */
    it('Test 5.4: should not trigger OAuth for non-OAuth profiles', async () => {
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => null),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => false), // No locks acquired for non-OAuth
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      // Create OAuthManager with settings to trigger shouldRequireOAuthEnabled check
      const mockSettings = {
        merged: {
          oauthEnabledProviders: {
            anthropic: false, // OAuth disabled for anthropic
          },
        },
        setValue: vi.fn(),
      };

      const oauthManager = new OAuthManager(tokenStore, mockSettings as never);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => {
          throw new Error('initiateAuth should not be called');
        }),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      // Stub getProfileBuckets to return empty array (no multi-bucket)
      vi.spyOn(
        oauthManager as unknown as { getProfileBuckets: () => unknown },
        'getProfileBuckets',
      ).mockResolvedValue([]);

      const result = await oauthManager.getToken('anthropic');

      // Should return null without triggering OAuth
      expect(result).toBeNull();
      expect(provider.initiateAuth).not.toHaveBeenCalled();
      expect(tokenStore.acquireAuthLock).not.toHaveBeenCalled();
    });

    /**
     * Test 5.5: Refresh flow uses refresh lock not auth lock
     * GIVEN an expired token with valid refresh_token
     * WHEN OAuthManager refreshes the token
     * THEN acquireRefreshLock is called (not acquireAuthLock)
     */
    it('Test 5.5: should use refresh lock for token refresh, not auth lock', async () => {
      const expiredToken = makeToken('expired-token', -10);
      const refreshedToken = makeToken('refreshed-token', 3600);

      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => expiredToken),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => {
          throw new Error('initiateAuth should not be called for refresh');
        }),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => refreshedToken),
      };
      oauthManager.registerProvider(provider);

      // Enable OAuth for the provider
      vi.spyOn(oauthManager, 'isOAuthEnabled').mockReturnValue(true);

      await oauthManager.getOAuthToken('anthropic');

      // Should use refresh lock, not auth lock
      expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({
          waitMs: 10000,
          staleMs: 30000,
        }),
      );
      expect(tokenStore.releaseRefreshLock).toHaveBeenCalled();
      expect(tokenStore.acquireAuthLock).not.toHaveBeenCalled();
      expect(provider.refreshToken).toHaveBeenCalled();
    });

    /**
     * Test 5.6: Lock released on cancellation
     * GIVEN OAuthManager acquires auth lock
     * AND user cancels during initiateAuth() (throws)
     * WHEN authenticate() exits
     * THEN releaseAuthLock was called
     * AND no token was persisted
     */
    it('Test 5.6: should release auth lock when initiateAuth throws', async () => {
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => null),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => {
          throw new Error('User cancelled authentication');
        }),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      await expect(
        oauthManager.authenticate('anthropic', 'default'),
      ).rejects.toThrow('User cancelled authentication');

      // Lock should be released despite error
      expect(tokenStore.releaseAuthLock).toHaveBeenCalledWith(
        'anthropic',
        'default',
      );
      // Token should NOT be persisted
      expect(tokenStore.saveToken).not.toHaveBeenCalled();
    });
  });

  describe('Integration: authenticateMultipleBuckets with TOCTOU', () => {
    /**
     * Integration test: Full multi-bucket flow with TOCTOU defense
     * GIVEN 3 buckets to authenticate
     * AND bucket2 gets authenticated cross-process during the flow
     * WHEN authenticateMultipleBuckets runs
     * THEN bucket1 and bucket3 are authenticated normally
     * AND bucket2 is skipped due to TOCTOU re-check
     */
    it('should handle full multi-bucket flow with cross-process auth', async () => {
      let getTokenCallCount = 0;
      const authenticateCallLog: string[] = [];

      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async (_provider: string, bucket?: string) => {
          getTokenCallCount++;
          // Upfront check calls: bucket1, bucket2, bucket3 (all return null)
          if (getTokenCallCount <= 3) {
            return null;
          }
          // TOCTOU re-check for bucket1: still null
          if (getTokenCallCount === 4 && bucket === 'bucket1') {
            return null;
          }
          // TOCTOU re-check for bucket2: cross-process wrote token!
          if (getTokenCallCount === 5 && bucket === 'bucket2') {
            return makeToken('cross-process-bucket2');
          }
          // TOCTOU re-check for bucket3: still null
          if (getTokenCallCount === 6 && bucket === 'bucket3') {
            return null;
          }
          return null;
        }),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => makeToken('new-token')),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      const authenticateSpy = vi
        .spyOn(oauthManager, 'authenticate')
        .mockImplementation(async (_providerName: string, bucket?: string) => {
          authenticateCallLog.push(bucket ?? 'default');
        });

      await oauthManager.authenticateMultipleBuckets('anthropic', [
        'bucket1',
        'bucket2',
        'bucket3',
      ]);

      // Only bucket1 and bucket3 should be authenticated
      // bucket2 skipped due to cross-process token
      expect(authenticateCallLog).toEqual(['bucket1', 'bucket3']);

      authenticateSpy.mockRestore();
    });
  });

  describe('Phase 5: Refresh before browser auth in authenticate()', () => {
    /**
     * Test: authenticate() refreshes expired token instead of opening browser
     * GIVEN authenticate() is called for a bucket
     * AND the disk has an expired token with a valid refresh_token
     * AND provider.refreshToken() succeeds
     * WHEN authenticate() runs
     * THEN provider.refreshToken() is called (not initiateAuth)
     * AND the refreshed token is saved to the store
     */
    it('should refresh expired token instead of opening browser', async () => {
      const expiredToken = makeToken('expired-access', -60);
      const refreshedToken = makeToken('refreshed-access', 3600);

      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => expiredToken),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => {
          throw new Error(
            'initiateAuth should NOT be called — refresh should suffice',
          );
        }),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => refreshedToken),
      };
      oauthManager.registerProvider(provider);

      await oauthManager.authenticate('anthropic', 'default');

      // Refresh lock should have been acquired and released
      expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({
          waitMs: 10000,
          staleMs: 30000,
          bucket: 'default',
        }),
      );
      expect(tokenStore.releaseRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        'default',
      );
      // Refresh should have been called with the expired disk token
      expect(provider.refreshToken).toHaveBeenCalledWith(expiredToken);
      // initiateAuth should NOT have been called
      expect(provider.initiateAuth).not.toHaveBeenCalled();
      // The refreshed token should be saved
      expect(tokenStore.saveToken).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({ access_token: 'refreshed-access' }),
        'default',
      );
    });

    /**
     * Test: authenticate() falls through to browser when refresh fails
     * GIVEN authenticate() is called for a bucket
     * AND the disk has an expired token with a refresh_token
     * AND provider.refreshToken() throws
     * WHEN authenticate() runs
     * THEN initiateAuth() IS called (browser fallback)
     */
    it('should fall through to browser auth when refresh fails', async () => {
      const expiredToken = makeToken('expired-access', -60);
      const freshToken = makeToken('browser-auth-token', 3600);

      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => expiredToken),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => freshToken),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => {
          throw new Error('Refresh token revoked');
        }),
      };
      oauthManager.registerProvider(provider);

      await oauthManager.authenticate('anthropic', 'default');

      // Refresh lock acquired and released even on failure
      expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({ bucket: 'default' }),
      );
      expect(tokenStore.releaseRefreshLock).toHaveBeenCalledWith(
        'anthropic',
        'default',
      );
      // Refresh was attempted but failed
      expect(provider.refreshToken).toHaveBeenCalled();
      // Falls through to browser auth
      expect(provider.initiateAuth).toHaveBeenCalled();
      // Browser token saved
      expect(tokenStore.saveToken).toHaveBeenCalledWith(
        'anthropic',
        expect.objectContaining({ access_token: 'browser-auth-token' }),
        'default',
      );
    });

    /**
     * Test: authenticate() skips refresh when no refresh_token
     * GIVEN authenticate() is called for a bucket
     * AND the disk has an expired token WITHOUT a refresh_token
     * WHEN authenticate() runs
     * THEN provider.refreshToken() is NOT called
     * AND initiateAuth() IS called
     */
    it('should skip refresh when disk token has no refresh_token', async () => {
      const expiredTokenNoRefresh: OAuthToken = {
        access_token: 'expired-access',
        refresh_token: '',
        expiry: Math.floor(Date.now() / 1000) - 60,
        token_type: 'Bearer' as const,
        scope: '',
      };
      const freshToken = makeToken('browser-auth-token', 3600);

      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => expiredTokenNoRefresh),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => freshToken),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      await oauthManager.authenticate('anthropic', 'default');

      // No refresh attempted (no refresh_token)
      expect(provider.refreshToken).not.toHaveBeenCalled();
      // Straight to browser auth
      expect(provider.initiateAuth).toHaveBeenCalled();
    });

    /**
     * Test: Lock timeout → re-read disk before browser auth
     * GIVEN authenticate() is called for a bucket
     * AND the disk has an expired token with a refresh_token
     * AND acquireRefreshLock returns false (another process holds it)
     * AND another process completes refresh while we wait
     * WHEN authenticate() checks disk after lock timeout
     * THEN it finds the fresh token and skips browser auth
     */
    it('should re-read disk after refresh-lock timeout and skip browser auth if another process refreshed', async () => {
      const expiredToken: OAuthToken = {
        access_token: 'expired-access',
        refresh_token: 'refresh-token',
        expiry: Math.floor(Date.now() / 1000) - 60,
        token_type: 'Bearer' as const,
        scope: '',
      };
      const crossProcessToken = makeToken('cross-process-refreshed', 3600);

      let getTokenCallCount = 0;
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => {
          getTokenCallCount++;
          // First call (auth lock path): return expired token
          // Second call (after refresh-lock timeout): return fresh token from other process
          if (getTokenCallCount <= 1) return expiredToken;
          return crossProcessToken;
        }),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => false), // Lock timeout!
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => {
          throw new Error('initiateAuth should NOT be called');
        }),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      await oauthManager.authenticate('anthropic', 'default');

      // Refresh lock was attempted but not acquired
      expect(tokenStore.acquireRefreshLock).toHaveBeenCalled();
      expect(tokenStore.releaseRefreshLock).not.toHaveBeenCalled();
      // No refresh attempted (lock not acquired)
      expect(provider.refreshToken).not.toHaveBeenCalled();
      // No browser auth (cross-process token found)
      expect(provider.initiateAuth).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    /**
     * Test: Empty bucket list
     * GIVEN authenticateMultipleBuckets with empty bucket array
     * WHEN the method runs
     * THEN it returns immediately without error
     */
    it('should handle empty bucket list gracefully', async () => {
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async () => null),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => {
          throw new Error('Should not be called');
        }),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      await expect(
        oauthManager.authenticateMultipleBuckets('anthropic', []),
      ).resolves.toBeUndefined();

      expect(provider.initiateAuth).not.toHaveBeenCalled();
    });

    /**
     * Test: All buckets already authenticated
     * GIVEN authenticateMultipleBuckets with 2 buckets
     * AND both buckets already have valid tokens
     * WHEN the method runs
     * THEN no authentication is triggered
     */
    it('should skip all buckets if already authenticated', async () => {
      const tokenStore: TokenStore = {
        saveToken: vi.fn(),
        getToken: vi.fn(async (_provider: string, bucket?: string) =>
          makeToken(`existing-${bucket}`),
        ),
        removeToken: vi.fn(),
        listProviders: vi.fn(async () => []),
        listBuckets: vi.fn(async () => []),
        getBucketStats: vi.fn(async () => null),
        acquireRefreshLock: vi.fn(async () => true),
        releaseRefreshLock: vi.fn(async () => undefined),
        acquireAuthLock: vi.fn(async () => true),
        releaseAuthLock: vi.fn(async () => undefined),
      };

      const oauthManager = new OAuthManager(tokenStore);

      const provider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn(async () => {
          throw new Error('Should not be called');
        }),
        getToken: vi.fn(async () => null),
        refreshToken: vi.fn(async () => null),
      };
      oauthManager.registerProvider(provider);

      const authenticateSpy = vi.spyOn(oauthManager, 'authenticate');

      await oauthManager.authenticateMultipleBuckets('anthropic', [
        'bucket1',
        'bucket2',
      ]);

      expect(authenticateSpy).not.toHaveBeenCalled();
      expect(provider.initiateAuth).not.toHaveBeenCalled();
    });
  });
});
