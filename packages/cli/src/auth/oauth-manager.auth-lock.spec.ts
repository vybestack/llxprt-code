/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for OAuthManager auth lock and TOCTOU defense
 * Related to issue #1652: Prevents concurrent authentication and token contamination
 */

import { describe, expect, it, vi } from 'vitest';
import { OAuthManager, type OAuthProvider } from './oauth-manager.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';

// Mock runtime settings to avoid MissingProviderRuntimeError
vi.mock('../runtime/runtimeSettings.js', () => ({
  getCliRuntimeServices: vi.fn(() => ({
    config: undefined,
    settings: undefined,
  })),
  getEphemeralSetting: vi.fn(() => undefined),
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
        getToken: vi.fn(async (provider: string, bucket?: string) => {
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
        getToken: vi.fn(async (provider: string, bucket?: string) => {
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
        getToken: vi.fn(async (provider: string, bucket?: string) => {
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
        .mockImplementation(async (providerName: string, bucket?: string) => {
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
        getToken: vi.fn(async (provider: string, bucket?: string) =>
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
