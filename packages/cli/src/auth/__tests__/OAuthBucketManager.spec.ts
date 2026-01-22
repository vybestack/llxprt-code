/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OAuthBucketManager } from '../OAuthBucketManager.js';
import type { TokenStore, OAuthToken } from '../types.js';

/**
 * Mock TokenStore for testing bucket manager
 */
class MockTokenStore implements TokenStore {
  private tokens = new Map<string, OAuthToken>();

  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    const key = this.getKey(provider, bucket);
    this.tokens.set(key, token);
  }

  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    const key = this.getKey(provider, bucket);
    return this.tokens.get(key) || null;
  }

  async removeToken(provider: string, bucket?: string): Promise<void> {
    const key = this.getKey(provider, bucket);
    this.tokens.delete(key);
  }

  async listProviders(): Promise<string[]> {
    const providers = new Set<string>();
    for (const key of this.tokens.keys()) {
      const provider = key.split(':')[0];
      providers.add(provider);
    }
    return Array.from(providers).sort();
  }

  async listBuckets(provider: string): Promise<string[]> {
    const buckets: string[] = [];
    for (const key of this.tokens.keys()) {
      if (key.startsWith(`${provider}:`)) {
        const bucket = key.split(':')[1];
        buckets.push(bucket);
      }
    }
    return buckets.sort();
  }

  async getBucketStats(): Promise<null> {
    return null;
  }

  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }

  async releaseRefreshLock(): Promise<void> {
    // No-op for mock
  }

  private getKey(provider: string, bucket?: string): string {
    return `${provider}:${bucket || 'default'}`;
  }

  clear(): void {
    this.tokens.clear();
  }

  setToken(provider: string, token: OAuthToken, bucket?: string): void {
    const key = this.getKey(provider, bucket);
    this.tokens.set(key, token);
  }
}

function createMockToken(
  accessToken: string,
  expiryOffset: number,
): OAuthToken {
  return {
    access_token: accessToken,
    refresh_token: 'refresh_token',
    expiry: Math.floor((Date.now() + expiryOffset) / 1000),
    token_type: 'Bearer',
    scope: 'read write',
  };
}

describe('OAuthBucketManager', () => {
  let tokenStore: MockTokenStore;
  let bucketManager: OAuthBucketManager;

  beforeEach(() => {
    tokenStore = new MockTokenStore();
    bucketManager = new OAuthBucketManager(tokenStore);
  });

  describe('Constructor', () => {
    /**
     * @requirement Phase 3 - Bucket Manager
     * @scenario OAuthBucketManager construction
     * @given TokenStore instance
     * @when OAuthBucketManager constructed
     * @then Instance created successfully
     * @and No errors thrown
     */
    it('should construct with TokenStore instance', () => {
      expect(() => new OAuthBucketManager(tokenStore)).not.toThrow();
      expect(bucketManager).toBeDefined();
    });
  });

  describe('Session Bucket State Management', () => {
    /**
     * @requirement Phase 3 - Session bucket state management
     * @scenario Set session bucket for provider
     * @given OAuthBucketManager instance
     * @when setSessionBucket('anthropic', 'work@company.com') called
     * @then Session bucket stored in-memory
     * @and Provider-scoped storage
     */
    it('should set session bucket for provider', () => {
      expect(() => {
        bucketManager.setSessionBucket('anthropic', 'work@company.com');
      }).not.toThrow();
    });

    /**
     * @requirement Phase 3 - Session bucket state management
     * @scenario Get session bucket for provider
     * @given Session bucket set to 'work@company.com'
     * @when getSessionBucket('anthropic') called
     * @then Returns 'work@company.com'
     */
    it('should get session bucket for provider', () => {
      bucketManager.setSessionBucket('anthropic', 'work@company.com');
      const result = bucketManager.getSessionBucket('anthropic');
      expect(result).toBe('work@company.com');
    });

    /**
     * @requirement Phase 3 - Session bucket state management
     * @scenario Get session bucket when not set
     * @given No session bucket set for provider
     * @when getSessionBucket('anthropic') called
     * @then Returns undefined
     */
    it('should return undefined when session bucket not set', () => {
      const result = bucketManager.getSessionBucket('anthropic');
      expect(result).toBeUndefined();
    });

    /**
     * @requirement Phase 3 - Session bucket state management
     * @scenario Clear session bucket for provider
     * @given Session bucket set to 'work@company.com'
     * @when clearSessionBucket('anthropic') called
     * @then Session bucket cleared
     * @and getSessionBucket returns undefined
     */
    it('should clear session bucket for provider', () => {
      bucketManager.setSessionBucket('anthropic', 'work@company.com');
      bucketManager.clearSessionBucket('anthropic');
      const result = bucketManager.getSessionBucket('anthropic');
      expect(result).toBeUndefined();
    });

    /**
     * @requirement Phase 3 - Session bucket state management
     * @scenario Session buckets are provider-scoped
     * @given Session buckets set for multiple providers
     * @when getSessionBucket called for each provider
     * @then Each provider returns its own session bucket
     * @and No cross-contamination between providers
     */
    it('should maintain provider-scoped session buckets', () => {
      bucketManager.setSessionBucket('anthropic', 'work@company.com');
      bucketManager.setSessionBucket('gemini', 'personal@gmail.com');

      expect(bucketManager.getSessionBucket('anthropic')).toBe(
        'work@company.com',
      );
      expect(bucketManager.getSessionBucket('gemini')).toBe(
        'personal@gmail.com',
      );
    });

    /**
     * @requirement Phase 3 - Session bucket state management
     * @scenario Session state is in-memory only
     * @given Session bucket set
     * @when OAuthBucketManager instance recreated
     * @then Session bucket state lost
     * @and Not persisted to TokenStore
     */
    it('should maintain session state in-memory only', () => {
      bucketManager.setSessionBucket('anthropic', 'work@company.com');

      const newBucketManager = new OAuthBucketManager(tokenStore);
      const result = newBucketManager.getSessionBucket('anthropic');
      expect(result).toBeUndefined();
    });

    /**
     * @requirement Phase 3 - Session bucket state management
     * @scenario Overwrite existing session bucket
     * @given Session bucket set to 'work@company.com'
     * @when setSessionBucket('anthropic', 'personal@gmail.com') called
     * @then Session bucket updated to 'personal@gmail.com'
     */
    it('should overwrite existing session bucket', () => {
      bucketManager.setSessionBucket('anthropic', 'work@company.com');
      bucketManager.setSessionBucket('anthropic', 'personal@gmail.com');

      const result = bucketManager.getSessionBucket('anthropic');
      expect(result).toBe('personal@gmail.com');
    });
  });

  describe('Bucket Resolution', () => {
    /**
     * @requirement Phase 3 - Bucket resolution
     * @scenario Resolve bucket with session override
     * @given Session bucket set to 'work@company.com'
     * @when resolveBucket('anthropic', ['bucket1', 'bucket2']) called
     * @then Returns session override 'work@company.com'
     * @and Ignores profile buckets
     */
    it('should prioritize session override over profile buckets', () => {
      bucketManager.setSessionBucket('anthropic', 'work@company.com');
      const result = bucketManager.resolveBucket('anthropic', [
        'bucket1',
        'bucket2',
      ]);
      expect(result).toBe('work@company.com');
    });

    /**
     * @requirement Phase 3 - Bucket resolution
     * @scenario Resolve bucket with profile buckets
     * @given No session override
     * @when resolveBucket('anthropic', ['bucket1', 'bucket2']) called
     * @then Returns first profile bucket 'bucket1'
     */
    it('should use first profile bucket when no session override', () => {
      const result = bucketManager.resolveBucket('anthropic', [
        'bucket1',
        'bucket2',
      ]);
      expect(result).toBe('bucket1');
    });

    /**
     * @requirement Phase 3 - Bucket resolution
     * @scenario Resolve bucket with no session or profile buckets
     * @given No session override and no profile buckets
     * @when resolveBucket('anthropic') called
     * @then Returns 'default'
     */
    it('should default to "default" bucket when no session or profile buckets', () => {
      const result = bucketManager.resolveBucket('anthropic');
      expect(result).toBe('default');
    });

    /**
     * @requirement Phase 3 - Bucket resolution
     * @scenario Resolve bucket with empty profile buckets array
     * @given No session override and empty profile buckets
     * @when resolveBucket('anthropic', []) called
     * @then Returns 'default'
     */
    it('should default to "default" bucket when profile buckets empty', () => {
      const result = bucketManager.resolveBucket('anthropic', []);
      expect(result).toBe('default');
    });

    /**
     * @requirement Phase 3 - Bucket resolution
     * @scenario Resolution priority order
     * @given Session override, profile buckets, and default all available
     * @when resolveBucket called
     * @then Priority: session > profile > default
     */
    it('should follow resolution priority: session > profile > default', () => {
      bucketManager.setSessionBucket('anthropic', 'session-bucket');
      const result = bucketManager.resolveBucket('anthropic', [
        'profile-bucket',
      ]);
      expect(result).toBe('session-bucket');

      bucketManager.clearSessionBucket('anthropic');
      const result2 = bucketManager.resolveBucket('anthropic', [
        'profile-bucket',
      ]);
      expect(result2).toBe('profile-bucket');

      const result3 = bucketManager.resolveBucket('anthropic');
      expect(result3).toBe('default');
    });
  });

  describe('Bucket Status', () => {
    /**
     * @requirement Phase 3 - Bucket listing and status
     * @scenario Get bucket status for valid bucket
     * @given Bucket 'work@company.com' with valid token
     * @when getBucketStatus('anthropic', 'work@company.com') called
     * @then Returns token expiry info
     * @and Shows authenticated status
     */
    it('should return bucket status with token expiry info', async () => {
      const token = createMockToken('access_token', 3600000); // 1 hour from now
      tokenStore.setToken('anthropic', token, 'work@company.com');

      const status = await bucketManager.getBucketStatus(
        'anthropic',
        'work@company.com',
      );

      expect(status).toBeDefined();
      expect(status.bucket).toBe('work@company.com');
      expect(status.authenticated).toBe(true);
      expect(status.expiry).toBe(token.expiry);
      expect(status.expiresIn).toBeGreaterThan(0);
    });

    /**
     * @requirement Phase 3 - Bucket listing and status
     * @scenario Get bucket status for non-existent bucket
     * @given Bucket does not exist
     * @when getBucketStatus('anthropic', 'nonexistent') called
     * @then Returns unauthenticated status
     * @and No expiry info
     */
    it('should return unauthenticated status for non-existent bucket', async () => {
      const status = await bucketManager.getBucketStatus(
        'anthropic',
        'nonexistent',
      );

      expect(status).toBeDefined();
      expect(status.bucket).toBe('nonexistent');
      expect(status.authenticated).toBe(false);
      expect(status.expiry).toBeUndefined();
      expect(status.expiresIn).toBeUndefined();
    });

    /**
     * @requirement Phase 3 - Bucket listing and status
     * @scenario Get bucket status for expired token
     * @given Bucket with expired token
     * @when getBucketStatus called
     * @then Returns authenticated but expired status
     * @and Negative expiresIn value
     */
    it('should indicate expired status for expired token', async () => {
      const token = createMockToken('access_token', -3600000); // 1 hour ago
      tokenStore.setToken('anthropic', token, 'work@company.com');

      const status = await bucketManager.getBucketStatus(
        'anthropic',
        'work@company.com',
      );

      expect(status.authenticated).toBe(true);
      expect(status.expiry).toBe(token.expiry);
      expect(status.expiresIn).toBeLessThan(0);
    });

    /**
     * @requirement Phase 3 - Bucket listing and status
     * @scenario Get all bucket status for provider
     * @given Multiple buckets for provider
     * @when getAllBucketStatus('anthropic') called
     * @then Returns status for all buckets
     * @and Includes expiry info for each
     */
    it('should return status for all buckets of a provider', async () => {
      const token1 = createMockToken('access_token_1', 3600000);
      const token2 = createMockToken('access_token_2', 7200000);
      tokenStore.setToken('anthropic', token1, 'work@company.com');
      tokenStore.setToken('anthropic', token2, 'personal@gmail.com');

      const statuses = await bucketManager.getAllBucketStatus('anthropic');

      expect(statuses).toHaveLength(2);
      expect(statuses.some((s) => s.bucket === 'work@company.com')).toBe(true);
      expect(statuses.some((s) => s.bucket === 'personal@gmail.com')).toBe(
        true,
      );
      expect(statuses.every((s) => s.authenticated)).toBe(true);
    });

    /**
     * @requirement Phase 3 - Bucket listing and status
     * @scenario Get all bucket status with no buckets
     * @given Provider with no buckets
     * @when getAllBucketStatus('anthropic') called
     * @then Returns empty array
     */
    it('should return empty array when provider has no buckets', async () => {
      const statuses = await bucketManager.getAllBucketStatus('anthropic');
      expect(statuses).toEqual([]);
    });

    /**
     * @requirement Phase 3 - Bucket listing and status
     * @scenario Status includes bucket name
     * @given Bucket status requested
     * @when getBucketStatus called
     * @then Status includes bucket name field
     */
    it('should include bucket name in status', async () => {
      const token = createMockToken('access_token', 3600000);
      tokenStore.setToken('anthropic', token, 'work@company.com');

      const status = await bucketManager.getBucketStatus(
        'anthropic',
        'work@company.com',
      );
      expect(status.bucket).toBe('work@company.com');
    });
  });

  describe('Bucket Validation', () => {
    /**
     * @requirement Phase 3 - Bucket validation
     * @scenario Validate existing bucket
     * @given Bucket 'work@company.com' exists with token
     * @when validateBucketExists('anthropic', 'work@company.com') called
     * @then No error thrown
     */
    it('should not throw error for existing bucket', async () => {
      const token = createMockToken('access_token', 3600000);
      tokenStore.setToken('anthropic', token, 'work@company.com');

      await expect(
        bucketManager.validateBucketExists('anthropic', 'work@company.com'),
      ).resolves.not.toThrow();
    });

    /**
     * @requirement Phase 3 - Bucket validation
     * @scenario Validate non-existent bucket
     * @given Bucket does not exist
     * @when validateBucketExists('anthropic', 'nonexistent') called
     * @then Throws error with bucket name
     * @and Error message includes provider
     */
    it('should throw error for non-existent bucket', async () => {
      await expect(
        bucketManager.validateBucketExists('anthropic', 'nonexistent'),
      ).rejects.toThrow('nonexistent');

      await expect(
        bucketManager.validateBucketExists('anthropic', 'nonexistent'),
      ).rejects.toThrow('anthropic');
    });

    /**
     * @requirement Phase 3 - Bucket validation
     * @scenario Validate default bucket when not exists
     * @given Default bucket does not exist
     * @when validateBucketExists('anthropic', 'default') called
     * @then Throws error
     */
    it('should throw error for non-existent default bucket', async () => {
      await expect(
        bucketManager.validateBucketExists('anthropic', 'default'),
      ).rejects.toThrow();
    });

    /**
     * @requirement Phase 3 - Bucket validation
     * @scenario Validation used before switching bucket
     * @given Need to switch to bucket
     * @when validateBucketExists called before switch
     * @then Prevents switching to invalid bucket
     */
    it('should validate bucket before switching', async () => {
      await expect(
        bucketManager.validateBucketExists('anthropic', 'nonexistent'),
      ).rejects.toThrow();
    });

    /**
     * @requirement Phase 3 - Bucket validation
     * @scenario Error message is actionable
     * @given Bucket validation fails
     * @when Error thrown
     * @then Error message suggests how to fix
     */
    it('should provide actionable error message', async () => {
      await expect(
        bucketManager.validateBucketExists('anthropic', 'missing'),
      ).rejects.toThrow(/authenticate|login|auth/i);
    });
  });

  describe('Failover Support', () => {
    /**
     * @requirement Phase 3 - Failover support
     * @scenario Get next bucket in failover chain
     * @given Profile buckets ['bucket1', 'bucket2', 'bucket3']
     * @when getNextBucket('anthropic', 'bucket1', profileBuckets) called
     * @then Returns 'bucket2'
     */
    it('should return next bucket in failover chain', () => {
      const profileBuckets = ['bucket1', 'bucket2', 'bucket3'];
      const result = bucketManager.getNextBucket(
        'anthropic',
        'bucket1',
        profileBuckets,
      );
      expect(result).toBe('bucket2');
    });

    /**
     * @requirement Phase 3 - Failover support
     * @scenario Get next bucket at end of chain
     * @given Profile buckets ['bucket1', 'bucket2', 'bucket3']
     * @when getNextBucket('anthropic', 'bucket3', profileBuckets) called
     * @then Returns undefined (no more buckets)
     */
    it('should return undefined when no more buckets in chain', () => {
      const profileBuckets = ['bucket1', 'bucket2', 'bucket3'];
      const result = bucketManager.getNextBucket(
        'anthropic',
        'bucket3',
        profileBuckets,
      );
      expect(result).toBeUndefined();
    });

    /**
     * @requirement Phase 3 - Failover support
     * @scenario Get next bucket with single bucket
     * @given Profile buckets ['bucket1']
     * @when getNextBucket('anthropic', 'bucket1', profileBuckets) called
     * @then Returns undefined
     */
    it('should return undefined for single bucket profile', () => {
      const profileBuckets = ['bucket1'];
      const result = bucketManager.getNextBucket(
        'anthropic',
        'bucket1',
        profileBuckets,
      );
      expect(result).toBeUndefined();
    });

    /**
     * @requirement Phase 3 - Failover support
     * @scenario Get next bucket from middle of chain
     * @given Profile buckets ['bucket1', 'bucket2', 'bucket3']
     * @when getNextBucket('anthropic', 'bucket2', profileBuckets) called
     * @then Returns 'bucket3'
     */
    it('should return next bucket from middle of chain', () => {
      const profileBuckets = ['bucket1', 'bucket2', 'bucket3'];
      const result = bucketManager.getNextBucket(
        'anthropic',
        'bucket2',
        profileBuckets,
      );
      expect(result).toBe('bucket3');
    });

    /**
     * @requirement Phase 3 - Failover support
     * @scenario Get next bucket when current not in chain
     * @given Profile buckets ['bucket1', 'bucket2']
     * @when getNextBucket('anthropic', 'unknown', profileBuckets) called
     * @then Returns undefined (current bucket not in failover chain)
     */
    it('should return undefined when current bucket not in chain', () => {
      const profileBuckets = ['bucket1', 'bucket2'];
      const result = bucketManager.getNextBucket(
        'anthropic',
        'unknown',
        profileBuckets,
      );
      expect(result).toBeUndefined();
    });

    /**
     * @requirement Phase 3 - Failover support
     * @scenario Failover chain maintains order
     * @given Profile buckets in specific order
     * @when getNextBucket called repeatedly
     * @then Returns buckets in order
     */
    it('should maintain failover chain order', () => {
      const profileBuckets = ['first', 'second', 'third', 'fourth'];

      const next1 = bucketManager.getNextBucket(
        'anthropic',
        'first',
        profileBuckets,
      );
      expect(next1).toBe('second');

      const next2 = bucketManager.getNextBucket(
        'anthropic',
        'second',
        profileBuckets,
      );
      expect(next2).toBe('third');

      const next3 = bucketManager.getNextBucket(
        'anthropic',
        'third',
        profileBuckets,
      );
      expect(next3).toBe('fourth');

      const next4 = bucketManager.getNextBucket(
        'anthropic',
        'fourth',
        profileBuckets,
      );
      expect(next4).toBeUndefined();
    });

    /**
     * @requirement Phase 3 - Failover support
     * @scenario Empty profile buckets
     * @given Empty profile buckets array
     * @when getNextBucket called
     * @then Returns undefined
     */
    it('should return undefined for empty profile buckets', () => {
      const result = bucketManager.getNextBucket('anthropic', 'bucket1', []);
      expect(result).toBeUndefined();
    });
  });

  describe('Integration Scenarios', () => {
    /**
     * @requirement Phase 3 - Integration
     * @scenario Complete bucket lifecycle
     * @given Multiple buckets with different statuses
     * @when Full bucket management operations performed
     * @then All operations work together correctly
     */
    it('should support complete bucket management lifecycle', async () => {
      const token1 = createMockToken('token1', 3600000);
      const token2 = createMockToken('token2', 7200000);
      tokenStore.setToken('anthropic', token1, 'work@company.com');
      tokenStore.setToken('anthropic', token2, 'personal@gmail.com');

      bucketManager.setSessionBucket('anthropic', 'work@company.com');

      const resolved = bucketManager.resolveBucket('anthropic', [
        'personal@gmail.com',
      ]);
      expect(resolved).toBe('work@company.com');

      const status = await bucketManager.getBucketStatus(
        'anthropic',
        'work@company.com',
      );
      expect(status.authenticated).toBe(true);

      await expect(
        bucketManager.validateBucketExists('anthropic', 'work@company.com'),
      ).resolves.not.toThrow();

      const profileBuckets = ['work@company.com', 'personal@gmail.com'];
      const next = bucketManager.getNextBucket(
        'anthropic',
        'work@company.com',
        profileBuckets,
      );
      expect(next).toBe('personal@gmail.com');
    });

    /**
     * @requirement Phase 3 - Integration
     * @scenario Multi-provider bucket management
     * @given Buckets for multiple providers
     * @when Operations performed on different providers
     * @then Provider isolation maintained
     */
    it('should maintain provider isolation in bucket management', async () => {
      const anthropicToken = createMockToken('anthropic_token', 3600000);
      const geminiToken = createMockToken('gemini_token', 7200000); // Different offset for isolation test

      tokenStore.setToken('anthropic', anthropicToken, 'work@company.com');
      tokenStore.setToken('gemini', geminiToken, 'work@company.com');

      bucketManager.setSessionBucket('anthropic', 'work@company.com');
      bucketManager.setSessionBucket('gemini', 'personal@gmail.com');

      expect(bucketManager.getSessionBucket('anthropic')).toBe(
        'work@company.com',
      );
      expect(bucketManager.getSessionBucket('gemini')).toBe(
        'personal@gmail.com',
      );

      const anthropicStatus = await bucketManager.getBucketStatus(
        'anthropic',
        'work@company.com',
      );
      const geminiStatus = await bucketManager.getBucketStatus(
        'gemini',
        'work@company.com',
      );

      expect(anthropicStatus.authenticated).toBe(true);
      expect(geminiStatus.authenticated).toBe(true);
      expect(anthropicStatus.expiry).not.toBe(geminiStatus.expiry);
    });

    /**
     * @requirement Phase 3 - Integration
     * @scenario Session state does not affect bucket storage
     * @given Session bucket set
     * @when TokenStore queried directly
     * @then Session state not persisted to storage
     */
    it('should keep session state separate from token storage', async () => {
      bucketManager.setSessionBucket('anthropic', 'session-bucket');

      const buckets = await tokenStore.listBuckets('anthropic');
      expect(buckets).not.toContain('session-bucket');
    });
  });
});
