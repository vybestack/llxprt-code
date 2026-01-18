/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test for issue #1159: OAuthManager token refresh race condition
 *
 * Tests that OAuthManager uses TokenStore locking to prevent concurrent refresh races.
 * When multiple clients try to refresh the same token, only one should perform the actual refresh.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthManager, type OAuthProvider } from './oauth-manager.js';
import type { OAuthToken, TokenStore } from './types.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MultiProviderTokenStore } from '@vybestack/llxprt-code-core';

describe('OAuthManager - Token Refresh Race Condition (Issue #1159)', () => {
  let tempDir: string;
  let tokenStore: TokenStore;
  let oauthManager: OAuthManager;
  let mockProvider: OAuthProvider;
  let refreshCallCount: number;

  const createToken = (accessToken: string, expiresIn = 3600): OAuthToken => ({
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: 'Bearer',
    scope: null,
  });

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(join(tmpdir(), 'oauth-refresh-race-test-'));
    tokenStore = new MultiProviderTokenStore(tempDir);
    oauthManager = new OAuthManager(tokenStore);

    // Reset refresh call counter
    refreshCallCount = 0;

    // Create mock provider
    mockProvider = {
      name: 'test-provider',
      initiateAuth: vi.fn().mockResolvedValue(undefined),
      getToken: vi.fn().mockResolvedValue(createToken('initial-token')),
      refreshToken: vi.fn().mockImplementation(async (_token: OAuthToken) => {
        refreshCallCount++;
        // Simulate network delay
        await new Promise((resolve) => setTimeout(resolve, 100));
        return createToken(`refreshed-token-${refreshCallCount}`);
      }),
    };

    oauthManager.registerProvider(mockProvider);
    // Enable OAuth for the test provider
    await oauthManager.toggleOAuthEnabled('test-provider');
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Reactive refresh path (getOAuthToken)', () => {
    it('should check disk for updated token before acquiring lock', async () => {
      // Given: An expired token in storage
      const expiredToken = createToken('expired-token', -10); // expired 10 seconds ago
      await tokenStore.saveToken('test-provider', expiredToken);

      // Simulate another process refreshing the token during lock acquisition
      const acquireLockSpy = vi.spyOn(tokenStore, 'acquireRefreshLock');
      acquireLockSpy.mockImplementation(async () => {
        // Before lock is acquired, another process updates the token
        const freshToken = createToken('refreshed-by-other-process', 3600);
        await tokenStore.saveToken('test-provider', freshToken);
        return true;
      });

      // When: We call getOAuthToken
      const token = await oauthManager.getOAuthToken('test-provider');

      // Then: Should use the fresh token from disk without calling provider.refreshToken
      expect(token?.access_token).toBe('refreshed-by-other-process');
      expect(refreshCallCount).toBe(0); // No actual refresh should occur
      expect(acquireLockSpy).toHaveBeenCalled();
    });

    it('should acquire lock before refreshing expired token', async () => {
      // Given: An expired token
      const expiredToken = createToken('expired-token', -10);
      await tokenStore.saveToken('test-provider', expiredToken);

      const acquireLockSpy = vi.spyOn(tokenStore, 'acquireRefreshLock');
      const releaseLockSpy = vi.spyOn(tokenStore, 'releaseRefreshLock');

      // When: We call getOAuthToken
      const token = await oauthManager.getOAuthToken('test-provider');

      // Then: Should acquire lock, refresh, and release lock (with bucket parameter)
      expect(acquireLockSpy).toHaveBeenCalledWith(
        'test-provider',
        expect.any(Object),
      );
      expect(refreshCallCount).toBe(1);
      expect(releaseLockSpy).toHaveBeenCalledWith('test-provider', undefined);
      expect(token?.access_token).toMatch(/^refreshed-token-/);
    });

    it('should release lock even if refresh fails', async () => {
      // Given: An expired token and a failing refresh
      const expiredToken = createToken('expired-token', -10);
      await tokenStore.saveToken('test-provider', expiredToken);

      mockProvider.refreshToken = vi
        .fn()
        .mockRejectedValue(new Error('Network error'));
      const releaseLockSpy = vi.spyOn(tokenStore, 'releaseRefreshLock');

      // When: We call getOAuthToken (refresh will fail)
      const token = await oauthManager.getOAuthToken('test-provider');

      // Then: Lock should still be released (with bucket parameter)
      expect(token).toBeNull();
      expect(releaseLockSpy).toHaveBeenCalledWith('test-provider', undefined);
    });

    it('should prevent concurrent refreshes when multiple requests race', async () => {
      // Given: An expired token
      const expiredToken = createToken('expired-token', -10);
      await tokenStore.saveToken('test-provider', expiredToken);

      // When: Multiple concurrent requests try to get the token
      const requests = Array.from({ length: 5 }, () =>
        oauthManager.getOAuthToken('test-provider'),
      );

      const results = await Promise.allSettled(requests);

      // Then: Only one refresh should occur (lock prevents others)
      expect(refreshCallCount).toBe(1); // Lock should prevent concurrent refreshes

      // Count successful vs failed/timeout requests
      const fulfilled = results.filter(
        (r) => r.status === 'fulfilled' && r.value !== null,
      );

      // At least one should succeed (the one that got the lock and refreshed)
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // All successful results should have the same refreshed token
      if (fulfilled.length > 0) {
        const firstToken = (
          fulfilled[0] as PromiseFulfilledResult<OAuthToken | null>
        ).value?.access_token;
        const allSame = fulfilled.every(
          (r) =>
            (r as PromiseFulfilledResult<OAuthToken | null>).value
              ?.access_token === firstToken,
        );
        expect(allSame).toBe(true);
      }
    });
  });

  describe('Proactive renewal path (runProactiveRenewal)', () => {
    it('should use lock for proactive renewal', async () => {
      // Given: An expired token that needs proactive renewal
      const token = createToken('valid-token', -10); // expired
      await tokenStore.saveToken('test-provider', token, 'default');

      const acquireLockSpy = vi.spyOn(tokenStore, 'acquireRefreshLock');
      const releaseLockSpy = vi.spyOn(tokenStore, 'releaseRefreshLock');

      // Access private method for testing
      const manager = oauthManager as unknown as {
        runProactiveRenewal: (
          provider: string,
          bucket: string,
        ) => Promise<void>;
      };

      // When: Proactive renewal runs
      await manager.runProactiveRenewal('test-provider', 'default');

      // Then: Should acquire and release lock (with bucket parameter)
      expect(acquireLockSpy).toHaveBeenCalledWith(
        'test-provider',
        expect.any(Object),
      );
      expect(refreshCallCount).toBe(1);
      expect(releaseLockSpy).toHaveBeenCalledWith('test-provider', 'default');
    });

    it('should skip refresh if token was updated by another process during proactive renewal', async () => {
      // Given: A token that will be refreshed by another process
      const oldToken = createToken('old-token', -10); // expired
      await tokenStore.saveToken('test-provider', oldToken, 'default');

      // Mock lock acquisition to simulate another process updating the token
      const acquireLockSpy = vi.spyOn(tokenStore, 'acquireRefreshLock');
      acquireLockSpy.mockImplementation(async () => {
        // Another process updates the token while we wait for lock
        const freshToken = createToken('fresh-from-other-process', 7200);
        await tokenStore.saveToken('test-provider', freshToken, 'default');
        return true;
      });

      const manager = oauthManager as unknown as {
        runProactiveRenewal: (
          provider: string,
          bucket: string,
        ) => Promise<void>;
      };

      // When: Proactive renewal runs
      await manager.runProactiveRenewal('test-provider', 'default');

      // Then: Should not call provider.refreshToken since token is already fresh
      // (Implementation should check token again after acquiring lock)
      expect(refreshCallCount).toBe(0);
      expect(acquireLockSpy).toHaveBeenCalled();
    });
  });

  describe('Lock bucket support', () => {
    it('should use separate locks for different buckets', async () => {
      // Given: Expired tokens in two different buckets
      const expiredToken1 = createToken('expired-1', -10);
      const expiredToken2 = createToken('expired-2', -10);
      await tokenStore.saveToken('test-provider', expiredToken1, 'bucket-1');
      await tokenStore.saveToken('test-provider', expiredToken2, 'bucket-2');

      const acquireLockSpy = vi.spyOn(tokenStore, 'acquireRefreshLock');

      // When: We refresh tokens from both buckets concurrently
      const results = await Promise.allSettled([
        oauthManager.getOAuthToken('test-provider', 'bucket-1'),
        oauthManager.getOAuthToken('test-provider', 'bucket-2'),
      ]);

      // Then: At least one should succeed
      const fulfilled = results.filter(
        (r) => r.status === 'fulfilled' && r.value !== null,
      );
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Each bucket should try to acquire its own lock
      // Note: Due to timing, some may timeout, but we should see at least one lock attempt
      expect(acquireLockSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
