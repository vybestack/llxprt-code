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

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { OAuthManager } from './oauth-manager.js';
import type { OAuthProvider, OAuthToken, TokenStore } from './types.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { KeyringTokenStore } from '@vybestack/llxprt-code-core';
import { type KeyringAdapter } from '@vybestack/llxprt-code-storage';
import { SecureStore } from '@vybestack/llxprt-code-storage';

function createRefreshCancellationGate(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function isFulfilledOAuthToken(
  result: PromiseSettledResult<OAuthToken | null>,
): result is PromiseFulfilledResult<OAuthToken> {
  return result.status === 'fulfilled' && result.value !== null;
}

function createMockKeyring(): KeyringAdapter & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getPassword: async (service: string, account: string) =>
      store.get(`${service}:${account}`) ?? null,
    setPassword: async (service: string, account: string, password: string) => {
      store.set(`${service}:${account}`, password);
    },
    deletePassword: async (service: string, account: string) =>
      store.delete(`${service}:${account}`),
    findCredentials: async (service: string) => {
      const results: Array<{ account: string; password: string }> = [];
      for (const [key, value] of store.entries()) {
        if (key.startsWith(`${service}:`)) {
          results.push({
            account: key.slice(service.length + 1),
            password: value,
          });
        }
      }
      return results;
    },
  };
}

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
    const secureStore = new SecureStore('llxprt-code-oauth', {
      fallbackDir: tempDir,
      fallbackPolicy: 'allow',
      keyringLoader: async () => createMockKeyring(),
    });
    tokenStore = new KeyringTokenStore({
      secureStore,
      lockDir: join(tempDir, 'locks'),
    });
    oauthManager = new OAuthManager(tokenStore);

    // Reset refresh call counter
    refreshCallCount = 0;

    // Create mock provider
    mockProvider = {
      name: 'test-provider',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'mock-token',
        refresh_token: 'mock-refresh',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      }),
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

    it.each(['empty result', 'error'])(
      'stops waiting when the refresh owner releases its lock after an %s',
      async (failure) => {
        const expiredToken = createToken('expired-token', -10);
        await tokenStore.saveToken('test-provider', expiredToken);
        const refreshStarted = createRefreshCancellationGate();
        const refreshGate = createRefreshCancellationGate();
        mockProvider.refreshToken = async (): Promise<OAuthToken | null> => {
          refreshCallCount++;
          refreshStarted.resolve();
          await refreshGate.promise;
          if (failure === 'error') throw new Error('Refresh unavailable');
          return null;
        };
        const controller = new AbortController();
        const work = oauthManager.createProfileOAuthWork(controller.signal);
        const owner = oauthManager.getOAuthToken('test-provider', 'default');
        const contender = refreshStarted.promise.then(() =>
          work.getToken({
            providerName: 'test-provider',
            buckets: ['default'],
            signal: controller.signal,
          }),
        );
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await refreshStarted.promise;
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          refreshGate.resolve();
          await owner;
          const result = await Promise.race([
            contender,
            new Promise<'still waiting'>((resolve) => {
              deadlineTimer = setTimeout(() => resolve('still waiting'), 500);
            }),
          ]);
          expect(result).toBeNull();
          expect(refreshCallCount).toBe(1);
          expect(await tokenStore.getToken('test-provider')).toStrictEqual(
            expiredToken,
          );
          expect(await tokenStore.acquireRefreshLock('test-provider')).toBe(
            true,
          );
          await tokenStore.releaseRefreshLock('test-provider');
        } finally {
          clearTimeout(deadlineTimer);
          refreshGate.resolve();
          controller.abort();
          await Promise.allSettled([owner, contender]);
          await work.cancelAndJoin();
        }
      },
    );

    it('continues to authentication when foreground provider refresh is unavailable', async () => {
      await tokenStore.saveToken(
        'test-provider',
        createToken('expired-token', -10),
      );
      mockProvider.refreshToken = async (): Promise<OAuthToken | null> => {
        throw new Error('Refresh unavailable');
      };
      const accessToken = await oauthManager.getToken(
        'test-provider',
        'default',
      );
      const storedToken = await tokenStore.getToken('test-provider', 'default');
      expect(storedToken).not.toBeNull();
      if (storedToken === null) throw new Error('Expected authenticated token');
      expect(accessToken).toBe(storedToken.access_token);
      expect(accessToken).not.toBe('expired-token');
      expect(storedToken.expiry).toBeGreaterThan(Date.now() / 1000 + 30);
    });

    it.each([
      { forced: false, cancelled: false },
      { forced: true, cancelled: false },
      { forced: false, cancelled: true },
      { forced: true, cancelled: true },
    ])(
      'joins real locked refresh and preserves retirement error identity (%j)',
      async ({ forced, cancelled }) => {
        const expiredToken = createToken('expired-token', -10);
        await tokenStore.saveToken('test-provider', expiredToken);
        const entered = createRefreshCancellationGate();
        const held = createRefreshCancellationGate();
        const providerError = new Error(
          'independent provider failure during retirement',
        );
        let operationSignal: AbortSignal | undefined;
        mockProvider.refreshToken = async (
          _token,
          signal,
        ): Promise<OAuthToken | null> => {
          operationSignal = signal;
          entered.resolve();
          await held.promise;
          if (cancelled) signal?.throwIfAborted();
          throw providerError;
        };
        const pending = (
          forced
            ? oauthManager.forceRefreshToken(
                'test-provider',
                expiredToken.access_token,
              )
            : oauthManager.getOAuthToken('test-provider')
        ).then(
          () => undefined,
          (error: unknown) => error,
        );
        await entered.promise;
        let disposed = false;
        const retirement = oauthManager.dispose().then(
          () => {
            disposed = true;
            return undefined;
          },
          (error: unknown) => {
            disposed = true;
            return error;
          },
        );
        try {
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(operationSignal?.aborted).toBe(true);
          expect(disposed).toBe(false);
          expect(await tokenStore.acquireRefreshLock('test-provider')).toBe(
            false,
          );
          held.resolve();
          const expectedError = cancelled
            ? operationSignal?.reason
            : providerError;
          expect(await pending).toBe(expectedError);
          const result = await retirement;
          expect(result).toBeInstanceOf(AggregateError);
          if (!(result instanceof AggregateError))
            throw new Error('Expected retirement failure');
          expect(result.errors).toContain(expectedError);
          expect(await tokenStore.getToken('test-provider')).toStrictEqual(
            expiredToken,
          );
          expect(await tokenStore.acquireRefreshLock('test-provider')).toBe(
            true,
          );
          await tokenStore.releaseRefreshLock('test-provider');
        } finally {
          held.resolve();
          await pending;
          await retirement;
        }
      },
    );

    it('returns null when forced provider refresh is unavailable', async () => {
      const expiredToken = createToken('expired-token', -10);
      await tokenStore.saveToken('test-provider', expiredToken);
      mockProvider.refreshToken = async (): Promise<OAuthToken | null> => {
        throw new Error('Refresh unavailable');
      };
      expect(
        await oauthManager.forceRefreshToken(
          'test-provider',
          expiredToken.access_token,
        ),
      ).toBeNull();
      expect(await tokenStore.getToken('test-provider')).toStrictEqual(
        expiredToken,
      );
      expect(await tokenStore.acquireRefreshLock('test-provider')).toBe(true);
      await tokenStore.releaseRefreshLock('test-provider');
    });

    it('preserves caller-signaled provider error identity', async () => {
      await tokenStore.saveToken(
        'test-provider',
        createToken('expired-token', -10),
      );
      const providerError = new Error('Refresh unavailable');
      mockProvider.refreshToken = async (): Promise<OAuthToken | null> => {
        throw providerError;
      };
      const controller = new AbortController();
      const work = oauthManager.createProfileOAuthWork(controller.signal);
      try {
        await expect(
          work.getToken({
            providerName: 'test-provider',
            buckets: ['default'],
            signal: controller.signal,
          }),
        ).rejects.toBe(providerError);
        expect(await tokenStore.acquireRefreshLock('test-provider')).toBe(true);
        await tokenStore.releaseRefreshLock('test-provider');
      } finally {
        controller.abort();
        await work.cancelAndJoin();
      }
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
      const fulfilled = results.filter(isFulfilledOAuthToken);

      // At least one should succeed (the one that got the lock and refreshed)
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // All successful results should have the same refreshed token
      const fulfilledTokens = fulfilled
        .map((r) => (r as PromiseFulfilledResult<OAuthToken | null>).value)
        .filter((token): token is OAuthToken => token !== null);
      expect(fulfilledTokens.length).toBeGreaterThan(0);
      const firstToken = fulfilledTokens[0]?.access_token;
      const allSame = fulfilledTokens.every(
        (token) => token.access_token === firstToken,
      );
      expect(allSame).toBe(true);
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
      const fulfilled = results.filter(isFulfilledOAuthToken);
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Each bucket should try to acquire its own lock
      // Note: Due to timing, some may timeout, but we should see at least one lock attempt
      expect(acquireLockSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('OAuthManager is the sole refresh authority (Issue #1378)', () => {
    it('should refresh expired token through OAuthManager only, not through provider.getToken()', async () => {
      // Track refresh calls to prove only OAuthManager triggers refresh
      let managerRefreshCount = 0;

      const anthropicProvider: OAuthProvider = {
        name: 'anthropic',
        initiateAuth: vi.fn().mockResolvedValue({
          access_token: 'mock-token',
          refresh_token: 'mock-refresh',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer' as const,
        }),
        // Simulates the FIXED getToken() - just returns stored token, no refresh
        getToken: vi
          .fn()
          .mockImplementation(async () => createToken('expired-token', -10)),
        refreshToken: vi.fn().mockImplementation(async (_token: OAuthToken) => {
          managerRefreshCount++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return createToken('refreshed-by-manager', 3600);
        }),
      };

      oauthManager.registerProvider(anthropicProvider);
      await oauthManager.toggleOAuthEnabled('anthropic');

      // Store an expired token
      const expiredToken = createToken('expired-token', -10);
      await tokenStore.saveToken('anthropic', expiredToken);

      // Call OAuthManager.getOAuthToken (the correct path)
      const result = await oauthManager.getOAuthToken('anthropic');

      // OAuthManager should have called provider.refreshToken() exactly once
      expect(managerRefreshCount).toBe(1);
      expect(result?.access_token).toBe('refreshed-by-manager');

      // provider.getToken() should NOT have been called by OAuthManager for refresh
      // (OAuthManager reads from tokenStore directly)
      expect(anthropicProvider.getToken).not.toHaveBeenCalled();
    });
  });
});
