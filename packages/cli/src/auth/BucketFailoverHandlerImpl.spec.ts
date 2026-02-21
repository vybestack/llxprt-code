/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BucketFailoverHandlerImpl } from './BucketFailoverHandlerImpl.js';
import { OAuthManager, type OAuthProvider } from './oauth-manager.js';
import type { OAuthToken, TokenStore } from '@vybestack/llxprt-code-core';

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
});
