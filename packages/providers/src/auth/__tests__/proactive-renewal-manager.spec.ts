/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for ProactiveRenewalManager — the extracted proactive token
 * renewal scheduler. Tests exercise the class directly, independent of
 * OAuthManager, to validate scheduling, backoff, lock parameters, and
 * lifecycle cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ProactiveRenewalManager,
  MAX_PROACTIVE_RENEWAL_FAILURES,
} from '../proactive-renewal-manager.js';
import type { OAuthProvider, TokenStore, OAuthToken } from '../types.js';

function createMockToken(
  expirySeconds: number,
  hasRefreshToken = true,
): OAuthToken {
  return {
    access_token: 'mock-access-token',
    token_type: 'Bearer' as const,
    refresh_token: hasRefreshToken ? 'mock-refresh-token' : '',
    expiry: expirySeconds,
  };
}

function createMockProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn().mockResolvedValue({
      access_token: 'mock-token',
      refresh_token: 'mock-refresh',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer' as const,
    }),
    getToken: vi.fn().mockResolvedValue(null),
    refreshToken: vi.fn().mockResolvedValue(null),
  };
}

function createMockTokenStore(): TokenStore {
  return {
    getToken: vi.fn().mockResolvedValue(null),
    saveToken: vi.fn().mockResolvedValue(undefined),
    removeToken: vi.fn().mockResolvedValue(undefined),
    listProviders: vi.fn().mockResolvedValue([]),
    listBuckets: vi.fn().mockResolvedValue([]),
    acquireRefreshLock: vi.fn().mockResolvedValue(true),
    releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
    acquireAuthLock: vi.fn(async () => true),
    releaseAuthLock: vi.fn(async () => undefined),
    getBucketStats: vi.fn().mockResolvedValue(null),
  };
}

describe('ProactiveRenewalManager', () => {
  let tokenStore: TokenStore;
  let provider: OAuthProvider;
  let manager: ProactiveRenewalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    tokenStore = createMockTokenStore();
    provider = createMockProvider('test-provider');
    manager = new ProactiveRenewalManager(
      tokenStore,
      (name: string) => (name === 'test-provider' ? provider : undefined),
      () => true,
    );
  });

  afterEach(() => {
    manager.clearAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('MAX_PROACTIVE_RENEWAL_FAILURES', () => {
    it('should export the constant with value 3', () => {
      expect(MAX_PROACTIVE_RENEWAL_FAILURES).toBe(3);
    });
  });

  describe('scheduleProactiveRenewal', () => {
    it('should calculate correct delay for tokens > 5min lifetime', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.getToken).mockResolvedValue(token);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);

      // For 600s remaining: lead = max(300, 60) = 300s
      // Timer should fire ~270-300s from now (300s minus up to 30s jitter)
      await vi.advanceTimersByTimeAsync(265 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(40 * 1000);
      expect(provider.refreshToken).toHaveBeenCalled();
    });

    it('should skip tokens with no refresh_token', () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600, false);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);

      // No timer should be scheduled — advance and verify no refresh call
      vi.advanceTimersByTime(600 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should skip tokens with empty refresh_token', () => {
      const nowSec = Date.now() / 1000;
      const token: OAuthToken = {
        access_token: 'access',
        token_type: 'Bearer',
        refresh_token: '   ',
        expiry: nowSec + 600,
      };

      manager.scheduleProactiveRenewal('test-provider', 'default', token);

      vi.advanceTimersByTime(600 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should skip tokens with lifetime <= 5min', () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 240);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);

      vi.advanceTimersByTime(300 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should skip entirely when LLXPRT_CREDENTIAL_SOCKET env var is set', () => {
      const originalEnv = process.env.LLXPRT_CREDENTIAL_SOCKET;
      process.env.LLXPRT_CREDENTIAL_SOCKET = '/tmp/test.sock';
      try {
        const nowSec = Date.now() / 1000;
        const token = createMockToken(nowSec + 600);

        manager.scheduleProactiveRenewal('test-provider', 'default', token);

        vi.advanceTimersByTime(600 * 1000);
        expect(provider.refreshToken).not.toHaveBeenCalled();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.LLXPRT_CREDENTIAL_SOCKET;
        } else {
          process.env.LLXPRT_CREDENTIAL_SOCKET = originalEnv;
        }
      }
    });

    it('should skip when OAuth is disabled for the provider', () => {
      const disabledManager = new ProactiveRenewalManager(
        tokenStore,
        (name: string) => (name === 'test-provider' ? provider : undefined),
        () => false,
      );

      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      disabledManager.scheduleProactiveRenewal(
        'test-provider',
        'default',
        token,
      );

      vi.advanceTimersByTime(600 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should not reschedule if token expiry is unchanged', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.getToken).mockResolvedValue(token);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);
      // Call again with same expiry — should be a no-op
      manager.scheduleProactiveRenewal('test-provider', 'default', token);

      await vi.advanceTimersByTimeAsync(305 * 1000);
      // Should only fire once (not twice)
      expect(provider.refreshToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('runProactiveRenewal', () => {
    it('should refresh token via provider and persist result', async () => {
      const nowSec = Date.now() / 1000;
      const currentToken = createMockToken(nowSec + 600);
      const refreshedToken = createMockToken(nowSec + 1200);

      vi.mocked(tokenStore.getToken).mockResolvedValue(currentToken);
      vi.mocked(provider.refreshToken).mockResolvedValue(refreshedToken);

      // Set scheduled token so double-check sees it matches
      manager.scheduleProactiveRenewal(
        'test-provider',
        'default',
        currentToken,
      );

      // Fire the timer
      await vi.advanceTimersByTimeAsync(305 * 1000);

      expect(provider.refreshToken).toHaveBeenCalledWith(currentToken);
      expect(tokenStore.saveToken).toHaveBeenCalled();
    });

    it('should handle refresh failure with retry backoff', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.getToken).mockResolvedValue(token);
      vi.mocked(provider.refreshToken).mockResolvedValue(null);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);

      // Trigger first failure
      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).toHaveBeenCalledTimes(1);

      // Retry backoff: 30s * 2^1 = 60s + up to 5s jitter
      await vi.advanceTimersByTimeAsync(70 * 1000);
      expect(provider.refreshToken).toHaveBeenCalledTimes(2);
    });

    it('should preserve refresh lock parameters (waitMs: 10000, staleMs: 30000)', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.getToken).mockResolvedValue(token);
      vi.mocked(provider.refreshToken).mockResolvedValue(null);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);

      await vi.advanceTimersByTimeAsync(305 * 1000);

      expect(tokenStore.acquireRefreshLock).toHaveBeenCalledWith(
        'test-provider',
        { waitMs: 10000, staleMs: 30000, bucket: 'default' },
      );
    });

    it('should not run if already in-flight for same key', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      // Make getToken block to simulate in-flight
      let resolveGetToken: ((value: OAuthToken | null) => void) | undefined;
      vi.mocked(tokenStore.getToken).mockImplementation(
        () =>
          new Promise<OAuthToken | null>((resolve) => {
            resolveGetToken = resolve;
          }),
      );
      vi.mocked(provider.refreshToken).mockResolvedValue(token);

      // Start first renewal (will block on getToken)
      const firstRun = manager.runProactiveRenewal('test-provider', 'default');

      // Start second renewal — should bail due to in-flight
      const secondRun = manager.runProactiveRenewal('test-provider', 'default');
      await secondRun;

      // Resolve the blocked getToken and complete first run
      resolveGetToken?.(token);
      await firstRun;

      // Only one call to acquireRefreshLock
      expect(tokenStore.acquireRefreshLock).toHaveBeenCalledTimes(1);
    });

    it('should clear renewal and return when OAuth disabled', async () => {
      const disabledManager = new ProactiveRenewalManager(
        tokenStore,
        (name: string) => (name === 'test-provider' ? provider : undefined),
        () => false,
      );

      await disabledManager.runProactiveRenewal('test-provider', 'default');

      expect(tokenStore.acquireRefreshLock).not.toHaveBeenCalled();
    });

    it('should retry when provider is not registered', async () => {
      const noProviderManager = new ProactiveRenewalManager(
        tokenStore,
        () => undefined,
        () => true,
      );

      await noProviderManager.runProactiveRenewal('test-provider', 'default');

      // Should not acquire lock (retries via scheduleProactiveRetry instead)
      expect(tokenStore.acquireRefreshLock).not.toHaveBeenCalled();
    });

    it('should retry when lock cannot be acquired', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.acquireRefreshLock).mockResolvedValue(false);
      vi.mocked(tokenStore.getToken).mockResolvedValue(token);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);
      await vi.advanceTimersByTimeAsync(305 * 1000);

      // Should not call refreshToken since lock was not acquired
      expect(provider.refreshToken).not.toHaveBeenCalled();
      // Should release refresh lock if NOT acquired? No - lock wasn't acquired so no release needed
      expect(tokenStore.releaseRefreshLock).not.toHaveBeenCalled();
    });
  });

  describe('retry backoff caps at MAX_PROACTIVE_RENEWAL_FAILURES', () => {
    it('should stop scheduling after 3 consecutive failures', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.getToken).mockResolvedValue(token);
      vi.mocked(provider.refreshToken).mockResolvedValue(null);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);

      // Trigger first failure
      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).toHaveBeenCalledTimes(1);

      // Trigger second failure (backoff: 30s * 2^1 = 60s + up to 5s jitter)
      await vi.advanceTimersByTimeAsync(70 * 1000);
      expect(provider.refreshToken).toHaveBeenCalledTimes(2);

      // Trigger third failure (backoff: 30s * 2^2 = 120s + up to 5s jitter)
      await vi.advanceTimersByTimeAsync(130 * 1000);
      expect(provider.refreshToken).toHaveBeenCalledTimes(3);

      // Clear the mock to verify no more retries
      vi.mocked(provider.refreshToken).mockClear();

      // Advance time significantly
      await vi.advanceTimersByTimeAsync(600 * 1000);

      // No more retries should have happened after 3 failures
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should reset failure counter after successful refresh', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);
      const refreshedToken = createMockToken(nowSec + 1200);

      vi.mocked(tokenStore.getToken)
        .mockResolvedValueOnce(token)
        .mockResolvedValueOnce(token)
        .mockResolvedValue(refreshedToken);

      vi.mocked(provider.refreshToken)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(refreshedToken)
        .mockResolvedValue(refreshedToken);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);

      // Trigger first failure
      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).toHaveBeenCalledTimes(1);

      // Trigger successful retry
      await vi.advanceTimersByTimeAsync(70 * 1000);
      expect(provider.refreshToken).toHaveBeenCalledTimes(2);

      vi.mocked(provider.refreshToken).mockClear();

      // If counter was reset, next renewal happens at normal schedule
      await vi.advanceTimersByTimeAsync(1100 * 1000);
      expect(provider.refreshToken).toHaveBeenCalled();
    });
  });

  describe('clearAllTimers', () => {
    it('should cancel all scheduled renewals', async () => {
      const nowSec = Date.now() / 1000;
      const token1 = createMockToken(nowSec + 600);
      const token2 = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.getToken).mockResolvedValue(token1);

      manager.scheduleProactiveRenewal('test-provider', 'bucket1', token1);
      manager.scheduleProactiveRenewal('test-provider', 'bucket2', token2);

      manager.clearAllTimers();

      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('clearRenewalsForProvider', () => {
    it('should clear specific provider+bucket renewal', async () => {
      const nowSec = Date.now() / 1000;
      const token1 = createMockToken(nowSec + 600);
      const token2 = {
        ...createMockToken(nowSec + 600),
        access_token: 'token-2',
      };

      vi.mocked(tokenStore.getToken).mockImplementation(
        async (_providerName, bucket) => {
          if (bucket === 'bucket1') return token1;
          if (bucket === 'bucket2') return token2;
          return null;
        },
      );

      manager.scheduleProactiveRenewal('test-provider', 'bucket1', token1);
      manager.scheduleProactiveRenewal('test-provider', 'bucket2', token2);

      manager.clearRenewalsForProvider('test-provider', 'bucket1');

      await vi.advanceTimersByTimeAsync(305 * 1000);
      // Only bucket2 should trigger
      expect(provider.refreshToken).toHaveBeenCalledTimes(1);
    });

    it('should clear all renewals for a provider when no bucket specified', async () => {
      const nowSec = Date.now() / 1000;
      const token1 = createMockToken(nowSec + 600);
      const token2 = {
        ...createMockToken(nowSec + 600),
        access_token: 'token-2',
      };

      vi.mocked(tokenStore.getToken).mockResolvedValue(token1);

      manager.scheduleProactiveRenewal('test-provider', 'bucket1', token1);
      manager.scheduleProactiveRenewal('test-provider', 'bucket2', token2);

      manager.clearRenewalsForProvider('test-provider');

      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('clearProactiveRenewal', () => {
    it('should remove a single renewal entry by key', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.getToken).mockResolvedValue(token);

      manager.scheduleProactiveRenewal('test-provider', 'default', token);
      manager.clearProactiveRenewal('test-provider:default');

      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('configureProactiveRenewalsForProfile', () => {
    it('should schedule for each bucket in profile', async () => {
      const nowSec = Date.now() / 1000;
      const tokenBucket1 = createMockToken(nowSec + 600);
      const tokenBucket2 = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.getToken).mockImplementation(
        async (_providerName, bucket) => {
          if (bucket === 'bucket1') return tokenBucket1;
          if (bucket === 'bucket2') return tokenBucket2;
          return null;
        },
      );

      await manager.configureProactiveRenewalsForProfile({
        provider: 'test-provider',
        auth: {
          type: 'oauth',
          buckets: ['bucket1', 'bucket2'],
        },
      });

      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).toHaveBeenCalledTimes(2);
    });

    it('should cancel timers not in the new profile', async () => {
      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);

      vi.mocked(tokenStore.getToken).mockResolvedValue(token);

      manager.scheduleProactiveRenewal('test-provider', 'old-bucket', token);

      await manager.configureProactiveRenewalsForProfile({
        provider: 'test-provider',
        auth: {
          type: 'oauth',
          buckets: ['new-bucket'],
        },
      });

      // The old-bucket timer should have been cancelled
      manager.clearRenewalsForProvider('test-provider', 'new-bucket');

      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should not schedule for disabled providers', async () => {
      const disabledManager = new ProactiveRenewalManager(
        tokenStore,
        (name: string) => (name === 'test-provider' ? provider : undefined),
        () => false,
      );

      const nowSec = Date.now() / 1000;
      const token = createMockToken(nowSec + 600);
      vi.mocked(tokenStore.getToken).mockResolvedValue(token);

      await disabledManager.configureProactiveRenewalsForProfile({
        provider: 'test-provider',
        auth: {
          type: 'oauth',
          buckets: ['default'],
        },
      });

      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });

    it('should skip buckets without tokens', async () => {
      vi.mocked(tokenStore.getToken).mockResolvedValue(null);

      await manager.configureProactiveRenewalsForProfile({
        provider: 'test-provider',
        auth: {
          type: 'oauth',
          buckets: ['no-token-bucket'],
        },
      });

      await vi.advanceTimersByTimeAsync(305 * 1000);
      expect(provider.refreshToken).not.toHaveBeenCalled();
    });
  });

  describe('normalizeBucket', () => {
    it('should return bucket when valid string', () => {
      expect(manager.normalizeBucket('my-bucket')).toBe('my-bucket');
    });

    it('should return "default" for undefined', () => {
      expect(manager.normalizeBucket(undefined)).toBe('default');
    });

    it('should return "default" for empty string', () => {
      expect(manager.normalizeBucket('')).toBe('default');
    });

    it('should return "default" for whitespace-only string', () => {
      expect(manager.normalizeBucket('   ')).toBe('default');
    });
  });

  describe('getProactiveRenewalKey', () => {
    it('should produce correct key format', () => {
      expect(manager.getProactiveRenewalKey('anthropic', 'prod')).toBe(
        'anthropic:prod',
      );
    });
  });
});
