/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager, type OAuthProvider } from './oauth-manager.js';
import type {
  OAuthToken,
  TokenStore,
  BucketFailureReason,
} from '@vybestack/llxprt-code-core';

class MemoryTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

  private toKey(provider: string, bucket?: string): string {
    return `${provider}:${bucket ?? 'default'}`;
  }

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    this.tokens.set(this.toKey(provider, bucket), token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    return this.tokens.get(this.toKey(provider, bucket)) ?? null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    this.tokens.delete(this.toKey(provider, bucket));
  }

  async listProviders(): Promise<string[]> {
    return [];
  }

  async listBuckets(): Promise<string[]> {
    return [];
  }

  async getBucketStats(): Promise<null> {
    return null;
  }

  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(): Promise<void> {
    // No-op
  }
}

function makeToken(accessToken: string): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'Bearer',
    scope: '',
  };
}

describe('BucketFailoverHandlerImpl', () => {
  let tokenStore: MemoryTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(() => {
    tokenStore = new MemoryTokenStore();
    oauthManager = new OAuthManager(tokenStore);

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(async () => undefined),
      getToken: vi.fn(async () => null),
      refreshToken: vi.fn(async () => null),
    };

    oauthManager.registerProvider(provider);
  });

  it('sets the session bucket to the first bucket when none is set', async () => {
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');

    expect(oauthManager.getSessionBucket('anthropic')).toBeUndefined();

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-a');
    expect(handler.getCurrentBucket()).toBe('bucket-a');
  });

  it('aligns the handler index with an existing session bucket', async () => {
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

    oauthManager.setSessionBucket('anthropic', 'bucket-b');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });

  it('skips buckets with missing tokens and updates session bucket on success', async () => {
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-c');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-c');
  });

  it('returns false when no further buckets are usable', async () => {
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    oauthManager.setSessionBucket('anthropic', 'bucket-a');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b'],
      'anthropic',
      oauthManager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(false);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-a');
  });

  it('wraps around to earlier buckets when later buckets are exhausted', async () => {
    await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
    await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

    // Start on bucket-c (the last one)
    oauthManager.setSessionBucket('anthropic', 'bucket-c');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(true);
    expect(handler.getCurrentBucket()).toBe('bucket-a');
    expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-a');
  });

  it('tries all other buckets before giving up', async () => {
    // Only the current bucket has a token; no other bucket has one
    await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
    oauthManager.setSessionBucket('anthropic', 'bucket-b');

    const handler = new BucketFailoverHandlerImpl(
      ['bucket-a', 'bucket-b', 'bucket-c'],
      'anthropic',
      oauthManager,
    );

    const result = await handler.tryFailover();

    expect(result).toBe(false);
    // Should remain on the current bucket since all others failed
    expect(handler.getCurrentBucket()).toBe('bucket-b');
  });

  describe('resetSession()', () => {
    it('clears the tried-buckets tracking so failover can try buckets again', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // First failover session: succeeds switching to bucket-b
      const firstResult = await handler.tryFailover();
      expect(firstResult).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');

      // Second tryFailover without resetSession: all buckets tried, returns false
      const secondResult = await handler.tryFailover();
      expect(secondResult).toBe(false);

      // After resetSession, failover can try buckets again
      handler.resetSession();
      const thirdResult = await handler.tryFailover();
      expect(thirdResult).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-a');
    });

    it('prevents infinite cycling when all buckets have valid tokens', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // First failover: switches to bucket-b (valid token)
      const first = await handler.tryFailover();
      expect(first).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');

      // Second failover without reset: bucket-a already tried this session, returns false
      const second = await handler.tryFailover();
      expect(second).toBe(false);
      // Should remain on bucket-b, not cycle back to bucket-a
      expect(handler.getCurrentBucket()).toBe('bucket-b');
    });

    it('resetSession() allows fresh failover after session ends', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      await handler.tryFailover(); // switches to bucket-b
      await handler.tryFailover(); // returns false (all buckets tried)

      handler.resetSession();

      // After reset, a new request starts fresh - bucket-a is no longer in tried set
      const result = await handler.tryFailover();
      expect(result).toBe(true);
    });

    it('resetSession() clears tried set but keeps current bucket position', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
      await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      await handler.tryFailover(); // switches to bucket-b

      handler.resetSession();

      expect(handler.getCurrentBucket()).toBe('bucket-b');
      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');
    });
  });

  describe('reset()', () => {
    it('resets to first bucket and restores session bucket to primary for fresh turn', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
      await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      await handler.tryFailover(); // switches to bucket-b

      expect(handler.getCurrentBucket()).toBe('bucket-b');
      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');

      handler.reset();

      expect(handler.getCurrentBucket()).toBe('bucket-a');
      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-a');
    });

    it('clears triedBucketsThisSession so all buckets can be retried', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      await handler.tryFailover(); // switches to bucket-b
      const failoverAfterAllTried = await handler.tryFailover(); // all tried, returns false
      expect(failoverAfterAllTried).toBe(false);

      handler.reset();

      const canFailoverAgain = await handler.tryFailover();
      expect(canFailoverAgain).toBe(true);
    });

    it('sets session bucket to first bucket when buckets array is not empty', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-b');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      handler.reset();

      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-a');
    });

    it('handles empty buckets array gracefully', async () => {
      const setSessionBucketSpy = vi.spyOn(oauthManager, 'setSessionBucket');

      const handler = new BucketFailoverHandlerImpl(
        [],
        'anthropic',
        oauthManager,
      );

      handler.reset();

      expect(handler.getCurrentBucket()).toBeUndefined();
      expect(setSessionBucketSpy).not.toHaveBeenCalled();
    });
  });

  /**
   * @plan PLAN-20260223-ISSUE1598.P04
   * Test suite for bucket classification during failover
   */
  describe('Classification accuracy', () => {
    /**
     * @requirement REQ-1598-CL01
     * @pseudocode bucket-classification.md lines 8-10
     * Test that a 429 status is classified as quota-exhausted
     */
    it('should classify 429 as quota-exhausted', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // Act: Call tryFailover with 429 status
      await handler.tryFailover({ triggeringStatus: 429 });

      // Assert: bucket-a should be classified as quota-exhausted
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons).toBeDefined();
      expect(reasons?.['bucket-a']).toBe('quota-exhausted');
    });

    /**
     * @requirement REQ-1598-CL02
     * Test that 401/403 with non-expired token is treated as auth failure, not skipped
     */
    it('should classify 401 with valid token as expired-refresh-failed for reauth', async () => {
      // Token is still valid (not expired) but server returned 401 (revoked)
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      // Mock refresh to fail (token was revoked server-side)
      const provider = oauthManager['providers'].get('anthropic');
      if (provider) {
        provider.refreshToken = vi.fn(async () => null);
      }

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // Act: Call tryFailover with 401 status
      const result = await handler.tryFailover({ triggeringStatus: 401 });

      // Assert: bucket-a should be classified as expired-refresh-failed (not 'skipped')
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons).toBeDefined();
      expect(reasons?.['bucket-a']).toBe('expired-refresh-failed');
      // Should have switched to bucket-b
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
    });

    /**
     * @requirement REQ-1598-CL02
     * @pseudocode bucket-classification.md lines 30-42
     * Test that expired token with failed refresh is classified as expired-refresh-failed
     */
    it('should classify expired+refresh-failed as expired-refresh-failed', async () => {
      // Create an expired token
      const expiredToken: OAuthToken = {
        access_token: 'expired-token',
        refresh_token: 'refresh-expired',
        expiry: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        token_type: 'Bearer',
        scope: '',
      };
      await tokenStore.saveToken('anthropic', expiredToken, 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      // Mock refresh to fail
      const provider = oauthManager['providers'].get('anthropic');
      if (provider) {
        provider.refreshToken = vi.fn(async () => null);
      }

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // Act: Call tryFailover
      const result = await handler.tryFailover();

      // Assert: bucket-a should be classified as expired-refresh-failed
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons).toBeDefined();
      expect(reasons?.['bucket-a']).toBe('expired-refresh-failed');
      // Should have switched to bucket-b
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
    });

    /**
     * @requirement REQ-1598-CL07
     * @pseudocode bucket-classification.md lines 30-42
     * Test that successful refresh in Pass 1 returns true immediately
     */
    it('should return true immediately when refresh succeeds in pass 1', async () => {
      // Create an expired token
      const expiredToken: OAuthToken = {
        access_token: 'expired-token',
        refresh_token: 'refresh-valid',
        expiry: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        token_type: 'Bearer',
        scope: '',
      };
      await tokenStore.saveToken('anthropic', expiredToken, 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      // Mock refresh to succeed
      const refreshedToken = makeToken('refreshed-token');
      const provider = oauthManager['providers'].get('anthropic');
      if (provider) {
        provider.refreshToken = vi.fn(async () => refreshedToken);
      }

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // Act: Call tryFailover (should succeed in Pass 1)
      const result = await handler.tryFailover();

      // Assert: Should return true immediately, stay on bucket-a
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-a');
    });

    /**
     * @requirement REQ-1598-CL03
     * @pseudocode bucket-classification.md lines 22-24
     * Test that null token is classified as no-token
     */
    it('should classify null token as no-token', async () => {
      // bucket-a has no token
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // Act: Call tryFailover
      const result = await handler.tryFailover();

      // Assert: bucket-a should be classified as no-token
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons).toBeDefined();
      expect(reasons?.['bucket-a']).toBe('no-token');
      // Should have switched to bucket-b
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
    });

    /**
     * @requirement REQ-1598-CL04
     * @pseudocode bucket-classification.md lines 16-19
     * Test that token-store read errors are classified as no-token
     */
    it('should classify token-store error as no-token', async () => {
      // Save a token so the null-token path won't trigger first
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      // Mock the token store's getToken to throw for bucket-a
      // This exercises the catch block in Pass 1 (lines 137-143)
      const originalStoreGetToken = tokenStore.getToken.bind(tokenStore);
      vi.spyOn(tokenStore, 'getToken').mockImplementation(
        async (provider, bucket) => {
          if (bucket === 'bucket-a') {
            throw new Error('Token store read error');
          }
          return originalStoreGetToken(provider, bucket);
        },
      );

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // Act: Call tryFailover
      const result = await handler.tryFailover();

      // Assert: bucket-a should be classified as no-token
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons).toBeDefined();
      expect(reasons?.['bucket-a']).toBe('no-token');
      // Should have switched to bucket-b
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
    });

    /**
     * @requirement REQ-1598-CL09
     * @pseudocode error-reporting.md lines 17-18
     * Test that lastFailoverReasons is cleared at start of tryFailover
     */
    it('should clear lastFailoverReasons at start of tryFailover', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // First call: establish some reasons
      await handler.tryFailover({ triggeringStatus: 429 });
      const firstReasons = handler.getLastFailoverReasons?.();
      expect(firstReasons?.['bucket-a']).toBe('quota-exhausted');

      // Reset session to allow retry
      handler.resetSession();

      // Second call: reasons should be cleared
      await handler.tryFailover();
      const secondReasons = handler.getLastFailoverReasons?.();
      // Should not have reasons from first call
      expect(secondReasons).toBeDefined();
      // First call had bucket-a as quota-exhausted, second call should have different/new reasons
      expect(secondReasons).not.toEqual(firstReasons);
    });

    /**
     * @requirement REQ-1598-IC09
     * @pseudocode error-reporting.md lines 14-15
     * Test that getLastFailoverReasons returns immutable copy
     */
    it('should return immutable copy from getLastFailoverReasons', async () => {
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // Call tryFailover to establish reasons
      await handler.tryFailover({ triggeringStatus: 429 });

      // Get reasons and try to mutate
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons).toBeDefined();

      if (reasons) {
        const originalBucketAReason = reasons['bucket-a'];
        // Try to mutate the returned object
        reasons['bucket-a'] = 'no-token' as BucketFailureReason;

        // Get reasons again - should not be affected by mutation
        const reasonsAgain = handler.getLastFailoverReasons?.();
        expect(reasonsAgain?.['bucket-a']).toBe(originalBucketAReason);
        expect(reasonsAgain?.['bucket-a']).not.toBe('no-token');
      }
    });
  });

  /**
   * @plan PLAN-20260223-ISSUE1598.P10
   * Test suite for Pass 2: Candidate search with classification
   */
  describe('Pass 2: Candidate search', () => {
    /**
     * @requirement REQ-1598-FL03
     * @pseudocode failover-handler.md lines 111-120
     * Test that Pass 2 switches to bucket with valid token
     */
    it('should switch to bucket with valid token', async () => {
      // Arrange: bucket-a (current) will fail, bucket-b has valid token
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
      await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Act: Trigger failover (Pass 1 will classify bucket-a, Pass 2 should find bucket-b)
      const result = await handler.tryFailover();

      // Assert: Should switch to bucket-b with valid token
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');
    });

    /**
     * @requirement REQ-1598-FL17
     * @pseudocode failover-handler.md lines 88-102
     * Test that Pass 2 refreshes expired token and switches on success
     */
    it('should refresh expired token and switch on success', async () => {
      // Arrange: bucket-a current, bucket-b has expired token, bucket-c has valid token
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');

      const expiredToken: OAuthToken = {
        access_token: 'expired-b',
        refresh_token: 'refresh-b',
        expiry: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        token_type: 'Bearer',
        scope: '',
      };
      await tokenStore.saveToken('anthropic', expiredToken, 'bucket-b');
      await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      // Mock refresh to succeed for bucket-b
      const refreshedToken = makeToken('refreshed-b');
      const provider = oauthManager['providers'].get('anthropic');
      if (provider) {
        provider.refreshToken = vi.fn(async () => refreshedToken);
      }

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Act: Trigger failover
      const result = await handler.tryFailover();

      // Assert: Should switch to bucket-b after successful refresh
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');
    });

    /**
     * @requirement REQ-1598-FL17
     * @pseudocode failover-handler.md lines 104-108
     * Test that Pass 2 classifies expired-refresh-failed when refresh fails
     */
    it('should classify expired-refresh-failed and continue on refresh failure', async () => {
      // Arrange: bucket-a current, bucket-b has expired token (refresh fails), bucket-c has valid token
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');

      const expiredToken: OAuthToken = {
        access_token: 'expired-b',
        refresh_token: 'refresh-b',
        expiry: Math.floor(Date.now() / 1000) - 3600,
        token_type: 'Bearer',
        scope: '',
      };
      await tokenStore.saveToken('anthropic', expiredToken, 'bucket-b');
      await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      // Mock refresh to fail
      const provider = oauthManager['providers'].get('anthropic');
      if (provider) {
        provider.refreshToken = vi.fn(async () => null);
      }

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Act: Trigger failover
      const result = await handler.tryFailover();

      // Assert: Should classify bucket-b as expired-refresh-failed and continue to bucket-c
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-c');
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons?.['bucket-b']).toBe('expired-refresh-failed');
    });

    /**
     * @requirement REQ-1598-FL13
     * @pseudocode failover-handler.md lines 64-68
     * Test that Pass 2 skips buckets already in triedBucketsThisSession
     */
    it('should skip buckets already in triedBucketsThisSession', async () => {
      // Arrange: All buckets have valid tokens
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
      await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Act: First failover switches to bucket-b
      const first = await handler.tryFailover();
      expect(first).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');

      // Second failover should skip bucket-a (already tried), go to bucket-c
      const second = await handler.tryFailover();
      expect(second).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-c');

      // Third failover should fail (all buckets tried)
      const third = await handler.tryFailover();
      expect(third).toBe(false);
    });

    /**
     * @requirement REQ-1598-FL13
     * @pseudocode failover-handler.md lines 64
     * Test that Pass 2 iterates buckets in profile order
     */
    it('should iterate buckets in profile order', async () => {
      // Arrange: Set up buckets in specific order
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
      await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Act & Assert: Should iterate in exact profile order
      const first = await handler.tryFailover();
      expect(first).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b'); // Next after bucket-a

      const second = await handler.tryFailover();
      expect(second).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-c'); // Next after bucket-b
    });

    /**
     * @requirement REQ-1598-FL03
     * @pseudocode failover-handler.md lines 74-82
     * Test that Pass 2 classifies no-token when getOAuthToken throws
     */
    it('should classify no-token when getOAuthToken throws', async () => {
      // Arrange: bucket-a current, bucket-b will throw on getOAuthToken, bucket-c valid
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      // bucket-b must have a stored token so Pass 2 reaches the getOAuthToken call
      await tokenStore.saveToken('anthropic', makeToken('t2'), 'bucket-b');
      await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      // Mock getOAuthToken to throw for bucket-b
      // This exercises the catch at lines 277-283 in Pass 2
      const originalGetToken = oauthManager.getOAuthToken.bind(oauthManager);
      oauthManager.getOAuthToken = vi.fn(async (provider, bucket) => {
        if (bucket === 'bucket-b') {
          throw new Error('Token store error');
        }
        return originalGetToken(provider, bucket);
      });

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Act: Trigger failover
      const result = await handler.tryFailover();

      // Assert: Should classify bucket-b as no-token and continue to bucket-c
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-c');
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons?.['bucket-b']).toBe('no-token');
    });

    /**
     * @requirement REQ-1598-FL03
     * @pseudocode failover-handler.md lines 80-82
     * Test that Pass 2 classifies no-token when token is null
     */
    it('should classify no-token when token is null', async () => {
      // Arrange: bucket-a current, bucket-b has no token, bucket-c valid
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      // bucket-b has no token
      await tokenStore.saveToken('anthropic', makeToken('t3'), 'bucket-c');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Act: Trigger failover
      const result = await handler.tryFailover();

      // Assert: Should classify bucket-b as no-token and continue to bucket-c
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-c');
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons?.['bucket-b']).toBe('no-token');
    });
  });

  /**
   * @plan PLAN-20260223-ISSUE1598.P10
   * Test suite for Pass 3: Foreground reauth
   */
  describe('Pass 3: Foreground reauth', () => {
    /**
     * @requirement REQ-1598-FL07
     * @pseudocode failover-handler.md lines 127-136
     * Test that Pass 3 attempts reauth for first no-token bucket
     */
    it('should attempt reauth for first no-token bucket', async () => {
      // Arrange: bucket-a current (no token), bucket-b no token, bucket-c no token
      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Mock authenticate to succeed and provide token for bucket-b
      const authenticateSpy = vi.fn(
        async (provider: string, bucket?: string) => {
          if (bucket === 'bucket-b') {
            await tokenStore.saveToken(
              'anthropic',
              makeToken('reauth-b'),
              bucket,
            );
          }
        },
      );
      oauthManager.authenticate = authenticateSpy;

      // Act: Trigger failover (Pass 2 will fail for all, Pass 3 should reauth bucket-b)
      const result = await handler.tryFailover();

      // Assert: Should attempt reauth for bucket-b (first no-token after bucket-a)
      expect(authenticateSpy).toHaveBeenCalledWith('anthropic', 'bucket-b');
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
    });

    /**
     * @requirement REQ-1598-FL07
     * @pseudocode failover-handler.md lines 127-136
     * Test that Pass 3 attempts reauth for first expired-refresh-failed bucket
     */
    it('should attempt reauth for first expired-refresh-failed bucket', async () => {
      // Arrange: bucket-a current (expired, refresh fails), bucket-b expired (refresh fails)
      const expiredTokenA: OAuthToken = {
        access_token: 'expired-a',
        refresh_token: 'refresh-a',
        expiry: Math.floor(Date.now() / 1000) - 3600,
        token_type: 'Bearer',
        scope: '',
      };
      const expiredTokenB: OAuthToken = {
        access_token: 'expired-b',
        refresh_token: 'refresh-b',
        expiry: Math.floor(Date.now() / 1000) - 3600,
        token_type: 'Bearer',
        scope: '',
      };
      await tokenStore.saveToken('anthropic', expiredTokenA, 'bucket-a');
      await tokenStore.saveToken('anthropic', expiredTokenB, 'bucket-b');

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      // Mock refresh to fail for all
      const provider = oauthManager['providers'].get('anthropic');
      if (provider) {
        provider.refreshToken = vi.fn(async () => null);
      }

      // Mock authenticate to succeed for bucket-b
      const authenticateSpy = vi.fn(
        async (provider: string, bucket?: string) => {
          if (bucket === 'bucket-b') {
            await tokenStore.saveToken(
              'anthropic',
              makeToken('reauth-b'),
              bucket,
            );
          }
        },
      );
      oauthManager.authenticate = authenticateSpy;

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Act: Trigger failover
      const result = await handler.tryFailover();

      // Assert: Should attempt reauth for bucket-b (first expired-refresh-failed after bucket-a)
      expect(authenticateSpy).toHaveBeenCalledWith('anthropic', 'bucket-b');
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
    });

    /**
     * @requirement REQ-1598-FL08
     * @pseudocode failover-handler.md lines 143-159
     * Test that Pass 3 validates token after reauth success
     */
    it('should validate token after reauth success', async () => {
      // Arrange: All buckets have no tokens
      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // Mock authenticate to succeed and save token
      oauthManager.authenticate = vi.fn(
        async (provider: string, bucket?: string) => {
          if (bucket === 'bucket-b') {
            await tokenStore.saveToken(
              'anthropic',
              makeToken('reauth-b'),
              bucket,
            );
          }
        },
      );

      // Act: Trigger failover
      const result = await handler.tryFailover();

      // Assert: Should validate token exists after reauth and switch
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');

      // Verify token actually exists in store
      const token = await tokenStore.getToken('anthropic', 'bucket-b');
      expect(token).not.toBeNull();
      expect(token?.access_token).toBe('reauth-b');
    });

    /**
     * @requirement REQ-1598-FL08, FL09
     * @pseudocode failover-handler.md lines 145-149
     * Test that Pass 3 classifies reauth-failed if token null after reauth
     */
    it('should classify reauth-failed if token is null after reauth', async () => {
      // Arrange: All buckets have no tokens
      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Mock authenticate to succeed but NOT save token (simulates auth success with null token)
      oauthManager.authenticate = vi.fn(
        async (_provider: string, _bucket?: string) => {
          // Do nothing - auth "succeeds" but no token is saved
        },
      );

      // Act: Trigger failover
      const result = await handler.tryFailover();

      // Assert: Should classify bucket-b as reauth-failed
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons?.['bucket-b']).toBe('reauth-failed');
      expect(result).toBe(false); // No buckets succeeded
    });

    /**
     * @requirement REQ-1598-FL10
     * @pseudocode failover-handler.md lines 161-165
     * Test that Pass 3 classifies reauth-failed if authenticate throws
     */
    it('should classify reauth-failed if authenticate throws', async () => {
      // Arrange: All buckets have no tokens
      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c'],
        'anthropic',
        oauthManager,
      );

      // Mock authenticate to throw
      oauthManager.authenticate = vi.fn(async () => {
        throw new Error('User cancelled authentication');
      });

      // Act: Trigger failover
      const result = await handler.tryFailover();

      // Assert: Should classify bucket-b as reauth-failed
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons?.['bucket-b']).toBe('reauth-failed');
      expect(result).toBe(false); // No buckets succeeded
    });

    /**
     * @requirement REQ-1598-FR03
     * @pseudocode failover-handler.md lines 129-135
     * Test that Pass 3 does NOT attempt reauth for quota-exhausted buckets
     */
    it('should not attempt reauth for quota-exhausted buckets', async () => {
      // Arrange: bucket-a classified as quota-exhausted, bucket-b no token
      await tokenStore.saveToken('anthropic', makeToken('t1'), 'bucket-a');
      // bucket-b has no token

      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      const authenticateSpy = vi.fn(
        async (provider: string, bucket?: string) => {
          if (bucket === 'bucket-b') {
            await tokenStore.saveToken(
              'anthropic',
              makeToken('reauth-b'),
              bucket,
            );
          }
        },
      );
      oauthManager.authenticate = authenticateSpy;

      // Act: Trigger failover with 429 status (quota-exhausted for bucket-a)
      const result = await handler.tryFailover({ triggeringStatus: 429 });

      // Assert: Should skip bucket-a (quota-exhausted) and reauth bucket-b (no-token)
      expect(authenticateSpy).toHaveBeenCalledWith('anthropic', 'bucket-b');
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');

      // Verify bucket-a was classified as quota-exhausted
      const reasons = handler.getLastFailoverReasons?.();
      expect(reasons?.['bucket-a']).toBe('quota-exhausted');
    });

    /**
     * @requirement REQ-1598-FL07
     * @pseudocode failover-handler.md lines 127-136
     * Test that Pass 3 attempts reauth for only ONE candidate
     */
    it('should attempt reauth for only ONE candidate', async () => {
      // Arrange: Multiple buckets with no tokens
      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b', 'bucket-c', 'bucket-d'],
        'anthropic',
        oauthManager,
      );

      const authenticateSpy = vi.fn(
        async (_provider: string, _bucket?: string) => {
          // Fail all reauth attempts - do NOT save token
        },
      );
      oauthManager.authenticate = authenticateSpy;

      // Act: Trigger failover (all buckets have no token)
      const result = await handler.tryFailover();

      // Assert: authenticate should be called exactly ONCE (not for every bucket)
      expect(authenticateSpy).toHaveBeenCalledTimes(1);
      expect(authenticateSpy).toHaveBeenCalledWith('anthropic', 'bucket-b'); // First eligible after bucket-a
      expect(result).toBe(false); // Failed because reauth didn't save token
    });

    /**
     * @requirement REQ-1598-FL08
     * @pseudocode failover-handler.md lines 150-159
     * Test that Pass 3 switches bucket after successful reauth with valid token
     */
    it('should switch bucket after successful reauth with valid token', async () => {
      // Arrange: All buckets have no tokens
      oauthManager.setSessionBucket('anthropic', 'bucket-a');

      const handler = new BucketFailoverHandlerImpl(
        ['bucket-a', 'bucket-b'],
        'anthropic',
        oauthManager,
      );

      // Mock authenticate to succeed and save valid token
      const reauthToken = makeToken('reauth-success');
      oauthManager.authenticate = vi.fn(
        async (provider: string, bucket?: string) => {
          if (bucket === 'bucket-b') {
            await tokenStore.saveToken('anthropic', reauthToken, bucket);
          }
        },
      );

      // Act: Trigger failover
      const result = await handler.tryFailover();

      // Assert: Should switch to bucket-b and return true
      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('bucket-b');
      expect(oauthManager.getSessionBucket('anthropic')).toBe('bucket-b');

      // Verify the token is the reauth token
      const storedToken = await tokenStore.getToken('anthropic', 'bucket-b');
      expect(storedToken?.access_token).toBe('reauth-success');
    });

    it('should allow reauth of the triggering bucket in single-bucket profiles', async () => {
      // Scenario: Only one bucket, token expired, refresh failed.
      // Pass 1 classifies it as expired-refresh-failed AND adds it to
      // triedBucketsThisSession. Pass 3 must still consider it for reauth.
      const expiredToken = makeToken('expired-access');
      expiredToken.expiry = Math.floor(Date.now() / 1000) - 100;
      await tokenStore.saveToken('anthropic', expiredToken, 'only-bucket');
      oauthManager.setSessionBucket('anthropic', 'only-bucket');

      const handler = new BucketFailoverHandlerImpl(
        ['only-bucket'],
        'anthropic',
        oauthManager,
      );

      // Mock authenticate to save a fresh token
      const freshToken = makeToken('fresh-after-reauth');
      oauthManager.authenticate = vi.fn(
        async (_provider: string, bucket?: string) => {
          if (bucket === 'only-bucket') {
            await tokenStore.saveToken('anthropic', freshToken, bucket);
          }
        },
      );

      const result = await handler.tryFailover();

      expect(result).toBe(true);
      expect(handler.getCurrentBucket()).toBe('only-bucket');
      expect(oauthManager.authenticate).toHaveBeenCalledWith(
        'anthropic',
        'only-bucket',
      );
    });
  });
});
