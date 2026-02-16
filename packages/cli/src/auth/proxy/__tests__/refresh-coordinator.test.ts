/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for RefreshCoordinator.
 *
 * Uses real RefreshCoordinator with in-memory TokenStore and
 * controllable refresh function. No mock theater — tests exercise
 * actual rate limiting, deduplication, retry, and sanitization logic.
 *
 * @plan PLAN-20250214-CREDPROXY.P19
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  TokenStore,
  OAuthToken,
  BucketStats,
} from '@vybestack/llxprt-code-core';
import { RefreshCoordinator } from '../refresh-coordinator.js';

// ─── In-Memory Test Double: TokenStore ───────────────────────────────────────

class InMemoryTokenStore implements TokenStore {
  private tokens: Map<string, OAuthToken> = new Map();
  private locks: Set<string> = new Set();

  private key(provider: string, bucket?: string): string {
    return bucket ? `${provider}:${bucket}` : provider;
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(this.key(provider, bucket), token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(this.key(provider, bucket)) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(this.key(provider, bucket));
  }

  async listProviders(): Promise<string[]> {
    const providers = new Set<string>();
    for (const k of this.tokens.keys()) {
      providers.add(k.split(':')[0]);
    }
    return [...providers];
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const k of this.tokens.keys()) {
      const parts = k.split(':');
      if (parts[0] === provider && parts.length > 1) {
        buckets.push(parts[1]);
      }
    }
    return buckets;
  }

  async getBucketStats(
    _provider: string,
    _bucket: string,
  ): Promise<BucketStats | null> {
    return null;
  }

  async acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    const k = this.key(provider, options?.bucket);
    if (this.locks.has(k)) return false;
    this.locks.add(k);
    return true;
  }

  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    this.locks.delete(this.key(provider, bucket));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeToken(overrides: Partial<OAuthToken> = {}): OAuthToken {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token-secret',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer' as const,
    ...overrides,
  };
}

/**
 * A controllable refresh function for testing — not a vi.fn() mock.
 * Tracks calls and allows controlling the next result.
 */
function createMockRefreshFn() {
  let nextResult: OAuthToken | Error = makeToken({
    access_token: 'refreshed-access-token',
  });
  const calls: Array<{ provider: string; token: OAuthToken }> = [];

  const fn = async (
    provider: string,
    currentToken: OAuthToken,
  ): Promise<OAuthToken> => {
    calls.push({ provider, token: currentToken });
    if (nextResult instanceof Error) throw nextResult;
    return nextResult;
  };

  return {
    fn,
    calls,
    setNextResult: (r: OAuthToken | Error) => {
      nextResult = r;
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RefreshCoordinator', () => {
  let tokenStore: InMemoryTokenStore;
  let refreshFn: ReturnType<typeof createMockRefreshFn>;
  let coordinator: RefreshCoordinator;

  beforeEach(() => {
    vi.useFakeTimers();
    tokenStore = new InMemoryTokenStore();
    refreshFn = createMockRefreshFn();
    coordinator = new RefreshCoordinator({
      tokenStore,
      refreshFn: refreshFn.fn,
      cooldownMs: 30_000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Basic Refresh ───────────────────────────────────────────────────────

  describe('basic refresh', () => {
    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R11.1
     * @scenario Refresh reads token, calls refreshFn, merges result, saves merged token, returns sanitized token
     * @given A stored token with refresh_token for provider "anthropic"
     * @when refresh("anthropic") is called
     * @then Reads token from store, calls refreshFn, merges, saves, returns sanitized token
     */
    it('reads current token, calls refreshFn, merges result, saves merged token, returns sanitized token', async () => {
      const storedToken = makeToken({
        access_token: 'old-access',
        refresh_token: 'secret-rt',
      });
      await tokenStore.saveToken('anthropic', storedToken);

      const refreshedToken = makeToken({
        access_token: 'new-access',
        expiry: Math.floor(Date.now() / 1000) + 7200,
      });
      refreshFn.setNextResult(refreshedToken);

      const result = await coordinator.refresh('anthropic');

      expect(result.status).toBe('ok');
      expect(result.token).toBeDefined();
      expect(result.token!.access_token).toBe('new-access');

      // Verify refreshFn was called with the stored token
      expect(refreshFn.calls.length).toBe(1);
      expect(refreshFn.calls[0].provider).toBe('anthropic');
      expect(refreshFn.calls[0].token.access_token).toBe('old-access');

      // Verify the merged token was saved to the store
      const saved = await tokenStore.getToken('anthropic');
      expect(saved).not.toBeNull();
      expect(saved!.access_token).toBe('new-access');
    });

    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R10.1
     * @scenario Returned token is sanitized — no refresh_token in result
     * @given A stored token with refresh_token
     * @when refresh succeeds
     * @then Returned token has status 'ok' and no refresh_token field
     */
    it('returns status ok with sanitized token (no refresh_token)', async () => {
      await tokenStore.saveToken(
        'anthropic',
        makeToken({
          refresh_token: 'super-secret-rt',
        }),
      );

      refreshFn.setNextResult(
        makeToken({
          access_token: 'new-access',
          refresh_token: 'new-secret-rt',
        }),
      );

      const result = await coordinator.refresh('anthropic');

      expect(result.status).toBe('ok');
      expect(result.token).toBeDefined();
      expect('refresh_token' in result.token!).toBe(false);
    });

    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R11.2
     * @scenario Returns NOT_FOUND when no token exists in store
     * @given No token stored for provider "missing"
     * @when refresh("missing") is called
     * @then Returns status 'error' with NOT_FOUND indication
     */
    it('returns error status when no token exists in store', async () => {
      const result = await coordinator.refresh('missing');

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    });
  });

  // ─── Rate Limiting ──────────────────────────────────────────────────────

  describe('rate limiting', () => {
    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R14.1
     * @scenario Second refresh within cooldown returns rate_limited with retryAfter
     * @given A refresh just completed successfully for "anthropic"
     * @when Another refresh is requested 5 seconds later and current token is expired
     * @then Returns status 'rate_limited' with retryAfter
     */
    it('returns rate_limited with retryAfter for second refresh within cooldown', async () => {
      // Store a token that will be "expired" after first refresh
      const token = makeToken({
        access_token: 'old',
        expiry: Math.floor(Date.now() / 1000) + 10,
      });
      await tokenStore.saveToken('anthropic', token);

      // First refresh succeeds
      refreshFn.setNextResult(
        makeToken({
          access_token: 'refreshed',
          expiry: Math.floor(Date.now() / 1000) + 10,
        }),
      );
      const first = await coordinator.refresh('anthropic');
      expect(first.status).toBe('ok');

      // Advance time 5 seconds (well within 30s cooldown)
      vi.advanceTimersByTime(5_000);

      // Simulate that the stored token is now expired
      await tokenStore.saveToken(
        'anthropic',
        makeToken({
          access_token: 'refreshed',
          expiry: Math.floor(Date.now() / 1000) - 1,
        }),
      );

      const second = await coordinator.refresh('anthropic');
      expect(second.status).toBe('rate_limited');
      expect(second.retryAfter).toBeDefined();
      expect(second.retryAfter!).toBeGreaterThan(0);
    });

    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R14.3
     * @scenario Refresh after cooldown period succeeds
     * @given A refresh completed 31 seconds ago
     * @when Another refresh is requested
     * @then Proceeds with refresh normally and returns 'ok'
     */
    it('allows refresh after cooldown period expires', async () => {
      await tokenStore.saveToken('anthropic', makeToken());

      // First refresh
      const first = await coordinator.refresh('anthropic');
      expect(first.status).toBe('ok');

      // Advance past cooldown
      vi.advanceTimersByTime(31_000);

      // Update stored token for second refresh
      await tokenStore.saveToken(
        'anthropic',
        makeToken({ access_token: 'still-old' }),
      );
      refreshFn.setNextResult(makeToken({ access_token: 'refreshed-again' }));

      const second = await coordinator.refresh('anthropic');
      expect(second.status).toBe('ok');
      expect(second.token!.access_token).toBe('refreshed-again');
    });

    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R14.2
     * @scenario Rate limiting is per provider+bucket — different providers not affected
     * @given A refresh just completed for "anthropic"
     * @when refresh("gemini") is requested within cooldown
     * @then "gemini" refresh proceeds normally (not rate limited)
     */
    it('rate limits independently per provider+bucket', async () => {
      await tokenStore.saveToken('anthropic', makeToken());
      await tokenStore.saveToken(
        'gemini',
        makeToken({ access_token: 'gemini-old' }),
      );

      // Refresh anthropic
      const anthropicResult = await coordinator.refresh('anthropic');
      expect(anthropicResult.status).toBe('ok');

      // Immediately refresh gemini — should not be rate limited
      refreshFn.setNextResult(makeToken({ access_token: 'gemini-new' }));
      const geminiResult = await coordinator.refresh('gemini');
      expect(geminiResult.status).toBe('ok');
      expect(geminiResult.token!.access_token).toBe('gemini-new');
    });
  });

  // ─── Concurrent Deduplication ───────────────────────────────────────────

  describe('concurrent deduplication', () => {
    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R11.3
     * @scenario Two concurrent refresh calls for same provider+bucket return same result
     * @given A stored token for "anthropic"
     * @when Two refresh calls are made concurrently
     * @then Both return the same result (deduplicated)
     */
    it('deduplicates concurrent refresh calls for the same provider+bucket', async () => {
      await tokenStore.saveToken('anthropic', makeToken());

      refreshFn.setNextResult(makeToken({ access_token: 'deduped-result' }));

      const [result1, result2] = await Promise.all([
        coordinator.refresh('anthropic'),
        coordinator.refresh('anthropic'),
      ]);

      expect(result1.status).toBe('ok');
      expect(result2.status).toBe('ok');
      expect(result1.token!.access_token).toBe('deduped-result');
      expect(result2.token!.access_token).toBe('deduped-result');

      // refreshFn should only have been called once
      expect(refreshFn.calls.length).toBe(1);
    });

    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R11.3
     * @scenario Two concurrent refresh calls for different providers are independent
     * @given Stored tokens for "anthropic" and "gemini"
     * @when refresh("anthropic") and refresh("gemini") are called concurrently
     * @then Both execute independently
     */
    it('handles concurrent refresh calls for different providers independently', async () => {
      await tokenStore.saveToken('anthropic', makeToken());
      await tokenStore.saveToken(
        'gemini',
        makeToken({ access_token: 'gemini-old' }),
      );

      let callCount = 0;
      const originalFn = refreshFn.fn;
      const trackingFn = async (
        provider: string,
        token: OAuthToken,
      ): Promise<OAuthToken> => {
        callCount++;
        return originalFn(provider, token);
      };

      const trackingCoordinator = new RefreshCoordinator({
        tokenStore,
        refreshFn: trackingFn,
        cooldownMs: 30_000,
      });

      refreshFn.setNextResult(makeToken({ access_token: 'refreshed' }));

      const [r1, r2] = await Promise.all([
        trackingCoordinator.refresh('anthropic'),
        trackingCoordinator.refresh('gemini'),
      ]);

      expect(r1.status).toBe('ok');
      expect(r2.status).toBe('ok');
      // Both providers should have triggered their own refresh
      expect(callCount).toBe(2);
    });
  });

  // ─── Error Handling ─────────────────────────────────────────────────────

  describe('error handling', () => {
    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R13.2
     * @scenario Auth error (401/invalid_grant) returns auth_error with no retry
     * @given A stored token for "anthropic"
     * @when refreshFn throws a 401/invalid_grant error
     * @then Returns status 'auth_error' immediately, no retry
     */
    it('returns auth_error for 401/invalid_grant errors without retrying', async () => {
      await tokenStore.saveToken('anthropic', makeToken());

      const authError = Object.assign(new Error('invalid_grant'), {
        status: 401,
        code: 'invalid_grant',
      });
      refreshFn.setNextResult(authError);

      const result = await coordinator.refresh('anthropic');

      expect(result.status).toBe('auth_error');
      // Should only be called once (no retry)
      expect(refreshFn.calls.length).toBe(1);
    });

    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R13.1
     * @scenario Transient error retries up to 2 times then returns error
     * @given A stored token for "anthropic"
     * @when refreshFn throws transient errors on all attempts
     * @then Retries twice and returns status 'error'
     */
    it('retries transient errors up to 2 times then returns error', async () => {
      await tokenStore.saveToken('anthropic', makeToken());

      const transientError = Object.assign(new Error('ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
      refreshFn.setNextResult(transientError);

      const resultPromise = coordinator.refresh('anthropic');

      // Advance through retry delays (1s + 3s)
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(3_000);

      const result = await resultPromise;

      expect(result.status).toBe('error');
      // Initial attempt + 2 retries = 3 total calls
      expect(refreshFn.calls.length).toBe(3);
    });

    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R13.3
     * @scenario Transient error that succeeds on retry returns 'ok'
     * @given A stored token for "anthropic"
     * @when refreshFn fails once with transient error, then succeeds
     * @then Returns status 'ok' with the refreshed token
     */
    it('returns ok when transient error succeeds on retry', async () => {
      await tokenStore.saveToken('anthropic', makeToken());

      let attemptCount = 0;
      const retryCoordinator = new RefreshCoordinator({
        tokenStore,
        refreshFn: async (
          _provider: string,
          _currentToken: OAuthToken,
        ): Promise<OAuthToken> => {
          attemptCount++;
          if (attemptCount === 1) {
            throw Object.assign(new Error('ECONNREFUSED'), {
              code: 'ECONNREFUSED',
            });
          }
          return makeToken({ access_token: 'retry-success' });
        },
        cooldownMs: 30_000,
      });

      const resultPromise = retryCoordinator.refresh('anthropic');

      // Advance past first retry delay
      await vi.advanceTimersByTimeAsync(1_000);

      const result = await resultPromise;

      expect(result.status).toBe('ok');
      expect(result.token!.access_token).toBe('retry-success');
      expect(attemptCount).toBe(2);
    });
  });

  // ─── Token Handling ─────────────────────────────────────────────────────

  describe('token handling', () => {
    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R10.2
     * @scenario Returned token is sanitized — refresh_token never crosses the boundary
     * @given A stored token with refresh_token
     * @when refresh succeeds
     * @then The returned token object does not contain refresh_token key
     */
    it('sanitizes returned token by removing refresh_token', async () => {
      await tokenStore.saveToken(
        'anthropic',
        makeToken({
          refresh_token: 'super-secret',
        }),
      );

      refreshFn.setNextResult(
        makeToken({
          access_token: 'new-access',
          refresh_token: 'also-secret',
        }),
      );

      const result = await coordinator.refresh('anthropic');

      expect(result.status).toBe('ok');
      expect(result.token).toBeDefined();
      // refresh_token must not be present in the returned token
      const keys = Object.keys(result.token!);
      expect(keys).not.toContain('refresh_token');
    });

    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R12.2
     * @scenario Merged token preserves existing refresh_token when refreshFn doesn't return one
     * @given A stored token with refresh_token "original-rt"
     * @when refreshFn returns a token without refresh_token
     * @then The saved merged token retains "original-rt"
     */
    it('preserves existing refresh_token when refreshFn omits it', async () => {
      await tokenStore.saveToken(
        'anthropic',
        makeToken({
          access_token: 'old-access',
          refresh_token: 'original-rt',
        }),
      );

      // Refresh result without refresh_token
      const refreshed: OAuthToken = {
        access_token: 'new-access',
        expiry: Math.floor(Date.now() / 1000) + 7200,
        token_type: 'Bearer' as const,
      };
      refreshFn.setNextResult(refreshed);

      const result = await coordinator.refresh('anthropic');

      expect(result.status).toBe('ok');
      expect(result.token!.access_token).toBe('new-access');

      // Verify stored token preserved refresh_token
      const stored = await tokenStore.getToken('anthropic');
      expect(stored).not.toBeNull();
      expect(stored!.refresh_token).toBe('original-rt');
      expect(stored!.access_token).toBe('new-access');
    });
  });

  // ─── Reset ──────────────────────────────────────────────────────────────

  describe('reset', () => {
    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R14.3
     * @scenario reset() clears rate limiting state allowing immediate refresh
     * @given A refresh just completed for "anthropic" (within cooldown)
     * @when reset() is called
     * @then Next refresh proceeds immediately without rate limiting
     */
    it('clears rate limiting state so immediate refresh is allowed', async () => {
      await tokenStore.saveToken('anthropic', makeToken());

      // First refresh establishes cooldown
      const first = await coordinator.refresh('anthropic');
      expect(first.status).toBe('ok');

      // Without reset, second refresh within cooldown would be rate-limited (if token expired)
      // Call reset to clear state
      coordinator.reset();

      // Store a new token and refresh again
      await tokenStore.saveToken(
        'anthropic',
        makeToken({ access_token: 'post-reset' }),
      );
      refreshFn.setNextResult(
        makeToken({ access_token: 'post-reset-refreshed' }),
      );

      const second = await coordinator.refresh('anthropic');
      expect(second.status).toBe('ok');
      expect(second.token!.access_token).toBe('post-reset-refreshed');
    });

    /**
     * @plan PLAN-20250214-CREDPROXY.P19
     * @requirement R11.3
     * @scenario reset() clears inflight map
     * @given No inflight requests
     * @when reset() is called
     * @then Coordinator accepts new requests normally afterward
     */
    it('clears inflight map allowing fresh requests', async () => {
      await tokenStore.saveToken('anthropic', makeToken());

      // First refresh
      refreshFn.setNextResult(makeToken({ access_token: 'first-result' }));
      const first = await coordinator.refresh('anthropic');
      expect(first.status).toBe('ok');

      coordinator.reset();

      // Advance past cooldown to avoid rate limit
      vi.advanceTimersByTime(31_000);

      // After reset, a new refresh works fine
      await tokenStore.saveToken(
        'anthropic',
        makeToken({ access_token: 'after-reset' }),
      );
      refreshFn.setNextResult(makeToken({ access_token: 'fresh-result' }));

      const second = await coordinator.refresh('anthropic');
      expect(second.status).toBe('ok');
      expect(second.token!.access_token).toBe('fresh-result');
    });
  });
});
