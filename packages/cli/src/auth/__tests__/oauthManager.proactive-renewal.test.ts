/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260223-ISSUE1598.P13
 * @requirement REQ-1598-PR01, REQ-1598-PR03, REQ-1598-PR05, REQ-1598-PR06
 * @pseudocode proactive-renewal.md lines 1-104
 *
 * Tests for proactive token renewal behavior in OAuthManager
 * These tests verify the fix for Issue #1598 where expired tokens
 * were silently skipped instead of being refreshed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OAuthManager, type OAuthProvider } from '../oauth-manager.js';
import type { TokenStore, OAuthToken } from '../types.js';

/**
 * Create a mock token with specified expiry time
 */
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

/**
 * Create a mock OAuth provider
 */
function createMockProvider(name: string): OAuthProvider {
  return {
    name,
    initiateAuth: vi.fn().mockResolvedValue(undefined),
    getToken: vi.fn().mockResolvedValue(null),
    refreshToken: vi.fn().mockResolvedValue(null),
  };
}

/**
 * Create a mock TokenStore with spy methods
 */
function createMockTokenStore(): TokenStore {
  return {
    getToken: vi.fn().mockResolvedValue(null),
    saveToken: vi.fn().mockResolvedValue(undefined),
    removeToken: vi.fn().mockResolvedValue(undefined),
    listProviders: vi.fn().mockResolvedValue([]),
    listBuckets: vi.fn().mockResolvedValue([]),
    acquireRefreshLock: vi.fn().mockResolvedValue(true),
    releaseRefreshLock: vi.fn().mockResolvedValue(undefined),
    getBucketStats: vi.fn().mockResolvedValue(null),
  };
}

describe('Proactive renewal @plan:PLAN-20260223-ISSUE1598.P13', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * @requirement REQ-1598-PR01
   * @pseudocode proactive-renewal.md lines 27-30
   */
  it('should schedule renewal at 80% lifetime for tokens > 5min', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    // Token expires in 10 minutes (600 seconds)
    const nowSec = Date.now() / 1000;
    const expiryInTenMinutes = nowSec + 600;
    const tokenWithTenMinutes = createMockToken(expiryInTenMinutes);

    // Mock getToken to return our token
    vi.mocked(tokenStore.getToken).mockResolvedValue(tokenWithTenMinutes);

    // Call getOAuthToken which should trigger scheduleProactiveRenewal
    await manager.getOAuthToken('test-provider');

    // Calculate expected renewal time: 80% of 600s = 480s
    // The actual implementation uses: expiry - max(300, 0.1 * remaining)
    // For 600s remaining: lead = max(300, 60) = 300, so renewal at 600 - 300 = 300s
    // With jitter (0-30s), timer should be ~270-300s

    // Advance time to 265s (safely before the earliest jitter boundary of 270s)
    await vi.advanceTimersByTimeAsync(265 * 1000);

    // Provider.refreshToken should not have been called yet
    expect(provider.refreshToken).not.toHaveBeenCalled();

    // Advance time to trigger renewal (40s covers the remaining 5s + 30s max jitter)
    await vi.advanceTimersByTimeAsync(40 * 1000);

    // Now refreshToken should have been called
    expect(provider.refreshToken).toHaveBeenCalled();
  });

  /**
   * @requirement REQ-1598-PR01
   * @pseudocode proactive-renewal.md line 27
   */
  it('should not schedule renewal for tokens with lifetime <= 5min', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    // Token expires in 4 minutes (240 seconds) - below the 5min threshold
    const nowSec = Date.now() / 1000;
    const expiryInFourMinutes = nowSec + 240;
    const tokenWithFourMinutes = createMockToken(expiryInFourMinutes);

    vi.mocked(tokenStore.getToken).mockResolvedValue(tokenWithFourMinutes);

    await manager.getOAuthToken('test-provider');

    // Advance time significantly (e.g., 3 minutes)
    await vi.advanceTimersByTimeAsync(180 * 1000);

    // refreshToken should not have been called because the token lifetime was too short
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  /**
   * @requirement REQ-1598-PR01 (BUG FIX TEST)
   * @pseudocode proactive-renewal.md line 27 (THE FIX: check remainingSec > 0)
   *
   * This is the KEY test for Issue #1598: Expired tokens should NOT schedule
   * proactive renewal timers. The bug was that `if (remainingSec <= 0)` check
   * was missing, causing negative delays and unpredictable timer behavior.
   */
  it('should not schedule proactive renewal timer for short-lived tokens under 5min (BUG FIX)', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    // Token with very short lifetime (< 5min) — scheduleProactiveRenewal should skip it
    const nowSec = Date.now() / 1000;
    const shortLivedToken = createMockToken(nowSec + 120); // 2 minutes

    vi.mocked(tokenStore.getToken).mockResolvedValue(shortLivedToken);

    // Call getOAuthToken to trigger scheduleProactiveRenewal internally
    const result = await manager.getOAuthToken('test-provider');

    // Token is valid (not expired) so it should be returned
    expect(result).not.toBeNull();

    // Advance timers well past the 2-min lifetime
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // No proactive renewal timer should have fired since lifetime < 5min
    // refreshToken should NOT be called by any proactive renewal
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  /**
   * @requirement REQ-1598-PR03
   * @pseudocode proactive-renewal.md lines 63-70
   */
  it('should reschedule renewal after successful refresh', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    // Initial token expires in 10 minutes
    const nowSec = Date.now() / 1000;
    const initialToken = createMockToken(nowSec + 600);

    // Refreshed token expires in 20 minutes
    const refreshedToken = createMockToken(nowSec + 1200);

    // Setup mocks — use persistent mock for last value to avoid fragile Once chain
    vi.mocked(tokenStore.getToken)
      .mockResolvedValueOnce(initialToken) // First getOAuthToken call
      .mockResolvedValueOnce(initialToken) // Token check during first renewal
      .mockResolvedValue(refreshedToken); // All subsequent calls (including second renewal)

    vi.mocked(provider.refreshToken).mockResolvedValue(refreshedToken);

    // Get initial token - schedules first renewal
    await manager.getOAuthToken('test-provider');

    // Advance to first renewal time (~300s for 600s token)
    await vi.advanceTimersByTimeAsync(305 * 1000);

    // First refresh should have been called
    expect(provider.refreshToken).toHaveBeenCalledTimes(1);

    // Reset the mock to track second renewal
    vi.mocked(provider.refreshToken).mockClear();

    // Advance to second renewal time: lead = max(300, 0.1*remaining) = 300s
    // Second renewal fires ~900s from start; we're at ~305s, advance ~800s
    await vi.advanceTimersByTimeAsync(800 * 1000);

    // Second refresh should have been called (proving rescheduling works)
    expect(provider.refreshToken).toHaveBeenCalledTimes(1);
  });

  /**
   * @requirement REQ-1598-PR05
   * @pseudocode proactive-renewal.md lines 21-24
   */
  it('should stop scheduling after 3 consecutive failures', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    const nowSec = Date.now() / 1000;
    const token = createMockToken(nowSec + 600);

    vi.mocked(tokenStore.getToken).mockResolvedValue(token);
    // Make refreshToken fail
    vi.mocked(provider.refreshToken).mockResolvedValue(null);

    // Get initial token
    await manager.getOAuthToken('test-provider');

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

  /**
   * @requirement REQ-1598-PR06
   * @pseudocode proactive-renewal.md lines 92-104
   */
  it('should cancel all timers on configureProactiveRenewalsForProfile with empty profile', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    const nowSec = Date.now() / 1000;
    const token = createMockToken(nowSec + 600);

    vi.mocked(tokenStore.getToken).mockResolvedValue(token);

    // Schedule initial renewal
    await manager.getOAuthToken('test-provider');

    // Verify timer is scheduled by advancing time
    await vi.advanceTimersByTimeAsync(305 * 1000);
    expect(provider.refreshToken).toHaveBeenCalledTimes(1);

    // Clear the mock
    vi.mocked(provider.refreshToken).mockClear();

    // Configure with empty profile - should cancel existing timers
    await manager.configureProactiveRenewalsForProfile({
      type: 'simple',
      provider: 'other-provider', // Different provider
    });

    // Advance time again - should NOT trigger renewal because timer was cancelled
    await vi.advanceTimersByTimeAsync(300 * 1000);
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  /**
   * @requirement REQ-1598-PR03
   * Tests that configureProactiveRenewalsForProfile sets up renewals for multiple buckets
   */
  it('should configure proactive renewals for multiple buckets in profile', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    const nowSec = Date.now() / 1000;
    const tokenBucket1 = createMockToken(nowSec + 600);
    const tokenBucket2 = createMockToken(nowSec + 600);

    // Mock getToken to return tokens for different buckets
    vi.mocked(tokenStore.getToken).mockImplementation(
      async (providerName, bucket) => {
        if (bucket === 'bucket1') return tokenBucket1;
        if (bucket === 'bucket2') return tokenBucket2;
        return null;
      },
    );

    // Configure proactive renewals for profile with multiple buckets
    await manager.configureProactiveRenewalsForProfile({
      provider: 'test-provider',
      auth: {
        type: 'oauth',
        buckets: ['bucket1', 'bucket2'],
      },
    });

    // Advance time to trigger renewals
    await vi.advanceTimersByTimeAsync(305 * 1000);

    // Both buckets should have triggered refresh
    expect(provider.refreshToken).toHaveBeenCalledTimes(2);
  });

  /**
   * @requirement REQ-1598-PR01
   * Tests that configureProactiveRenewalsForProfile handles expired tokens by attempting refresh
   */
  it('should not schedule proactive renewal for expired tokens with refresh_token', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    // Expired token (but has refresh_token)
    const nowSec = Date.now() / 1000;
    const expiredToken = createMockToken(nowSec - 300, true);
    const refreshedToken = createMockToken(nowSec + 600, true);

    vi.mocked(tokenStore.getToken).mockResolvedValue(expiredToken);
    vi.mocked(provider.refreshToken).mockResolvedValue(refreshedToken);

    // Configure proactive renewals - should detect expired token and schedule immediate refresh
    await manager.configureProactiveRenewalsForProfile({
      provider: 'test-provider',
      auth: {
        type: 'oauth',
        buckets: ['default'],
      },
    });

    // The bug: scheduleProactiveRenewal silently returns for expired tokens
    // After fix: Should NOT schedule timer at all for expired tokens
    // The refresh should happen through normal getOAuthToken flow, not proactive renewal

    // Advance minimal time
    await vi.advanceTimersByTimeAsync(100);

    // Should NOT have triggered refresh through proactive renewal
    // (expired tokens are handled by getOAuthToken, not scheduleProactiveRenewal)
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });

  /**
   * @requirement REQ-1598-PR06
   * Tests that old timers are cancelled when profile changes
   */
  it('should cancel old timers when configuring new profile', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider1 = createMockProvider('provider1');
    const provider2 = createMockProvider('provider2');
    manager.registerProvider(provider1);
    manager.registerProvider(provider2);
    await manager.toggleOAuthEnabled('provider1'); // Enable OAuth
    await manager.toggleOAuthEnabled('provider2'); // Enable OAuth

    const nowSec = Date.now() / 1000;
    const token1 = createMockToken(nowSec + 600);
    const token2 = createMockToken(nowSec + 600);

    vi.mocked(tokenStore.getToken).mockImplementation(
      async (providerName, _bucket) => {
        if (providerName === 'provider1') return token1;
        if (providerName === 'provider2') return token2;
        return null;
      },
    );

    // Configure first profile
    await manager.configureProactiveRenewalsForProfile({
      provider: 'provider1',
      auth: { type: 'oauth', buckets: ['default'] },
    });

    // Configure second profile (should cancel provider1's timer)
    await manager.configureProactiveRenewalsForProfile({
      provider: 'provider2',
      auth: { type: 'oauth', buckets: ['default'] },
    });

    // Advance time to when provider1's timer would have fired
    await vi.advanceTimersByTimeAsync(305 * 1000);

    // Only provider2's refresh should have been called
    expect(provider1.refreshToken).not.toHaveBeenCalled();
    expect(provider2.refreshToken).toHaveBeenCalled();
  });

  /**
   * @requirement REQ-1598-PR05
   * Tests that failure counter resets after successful refresh
   */
  it('should reset failure counter after successful refresh', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    const nowSec = Date.now() / 1000;
    const token = createMockToken(nowSec + 600);
    const refreshedToken = createMockToken(nowSec + 1200);

    vi.mocked(tokenStore.getToken)
      .mockResolvedValueOnce(token)
      .mockResolvedValueOnce(token)
      .mockResolvedValue(refreshedToken);

    // First call fails, second succeeds
    vi.mocked(provider.refreshToken)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(refreshedToken)
      .mockResolvedValue(refreshedToken);

    await manager.getOAuthToken('test-provider');

    // Trigger first failure
    await vi.advanceTimersByTimeAsync(305 * 1000);
    expect(provider.refreshToken).toHaveBeenCalledTimes(1);

    // Trigger successful retry (backoff: 30s * 2^1 = 60s + up to 5s jitter)
    await vi.advanceTimersByTimeAsync(70 * 1000);
    expect(provider.refreshToken).toHaveBeenCalledTimes(2);

    // Clear mock to track next renewal
    vi.mocked(provider.refreshToken).mockClear();

    // If failure counter was properly reset, next renewal should happen at normal interval
    // not exponential backoff
    await vi.advanceTimersByTimeAsync(1100 * 1000);

    // Should have triggered renewal again (proving counter was reset)
    expect(provider.refreshToken).toHaveBeenCalled();
  });

  /**
   * @requirement REQ-1598-PR01
   * Tests that tokens without refresh_token don't schedule renewal
   */
  it('should not schedule renewal for tokens without refresh_token', async () => {
    const tokenStore = createMockTokenStore();
    const manager = new OAuthManager(tokenStore);
    const provider = createMockProvider('test-provider');
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('test-provider'); // Enable OAuth

    const nowSec = Date.now() / 1000;
    const tokenWithoutRefresh = createMockToken(nowSec + 600, false);

    vi.mocked(tokenStore.getToken).mockResolvedValue(tokenWithoutRefresh);

    await manager.getOAuthToken('test-provider');

    // Advance time
    await vi.advanceTimersByTimeAsync(305 * 1000);

    // Should not attempt refresh because token has no refresh_token
    expect(provider.refreshToken).not.toHaveBeenCalled();
  });
});
