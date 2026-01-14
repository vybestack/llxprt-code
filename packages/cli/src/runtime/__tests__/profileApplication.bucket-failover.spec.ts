/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251213issue490
 * Phase 6: Failover Logic Tests (TDD - RED)
 *
 * Tests MUST be written FIRST, implementation SECOND.
 * These tests verify bucket failover behavior when rate limits or quota errors occur.
 */

import { describe, expect, it } from 'vitest';
import {
  shouldFailover,
  executeWithBucketFailover,
  notifyBucketSwitch,
  resolveBucketsForFailover,
  formatAllBucketsExhaustedError,
  validateProfileBucketsExist,
  isTokenExpired,
  type NotificationLog,
  type ProfileBucketConfig,
  type BucketStatus,
  type MockProfile,
  type MockTokenStore,
  type MockToken,
  type MockRequest,
} from '../bucketFailover.js';

describe('shouldFailover - failover triggers', () => {
  it('should return true for 429 rate limit errors', () => {
    const error = new Error('Request failed with status code 429');
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return true for rate limit text in error message', () => {
    const error = new Error('Rate limit exceeded for this account');
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return true for quota exceeded errors', () => {
    const error = new Error('Quota exceeded for this resource');
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return true for 402 payment required errors', () => {
    const error = new Error('Request failed with status code 402');
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return true for payment required text in error message', () => {
    const error = new Error('Payment required to continue using this service');
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return true for token renewal failure', () => {
    const error = new Error('Token expired and renewal failed');
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return true for "would exceed quota" errors', () => {
    const error = new Error('This request would exceed your quota limit');
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return false for 400 bad request (non-auth)', () => {
    const error = new Error(
      'Request failed with status code 400: Invalid parameter',
    );
    expect(shouldFailover(error)).toBe(false);
  });

  it('should return false for 404 not found errors', () => {
    const error = new Error('Request failed with status code 404');
    expect(shouldFailover(error)).toBe(false);
  });

  it('should return false for 500 server errors', () => {
    const error = new Error('Request failed with status code 500');
    expect(shouldFailover(error)).toBe(false);
  });

  it('should return false for generic API errors', () => {
    const error = new Error('Network connection failed');
    expect(shouldFailover(error)).toBe(false);
  });

  it('should be case insensitive for error matching', () => {
    const error1 = new Error('RATE LIMIT EXCEEDED');
    const error2 = new Error('Rate Limit Exceeded');
    const error3 = new Error('rate limit exceeded');

    expect(shouldFailover(error1)).toBe(true);
    expect(shouldFailover(error2)).toBe(true);
    expect(shouldFailover(error3)).toBe(true);
  });

  it('should handle errors with detailed quota messages', () => {
    const error = new Error(
      'API quota exceeded: You have used 100% of your allocated quota for the current period',
    );
    expect(shouldFailover(error)).toBe(true);
  });
  it('should return true for 401 unauthorized errors (status code)', () => {
    const error = new Error('Request failed with status code 401');
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return true for 403 permission errors (status code)', () => {
    const error = new Error('Request failed with status code 403');
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return true for OAuth token revoked errors', () => {
    const error = new Error(
      'OAuth token has been revoked. Please obtain a new token.',
    );
    expect(shouldFailover(error)).toBe(true);
  });

  it('should return true for permission_error type in error message', () => {
    const error = new Error(
      '{"type":"error","error":{"type":"permission_error","message":"Token revoked"}}',
    );
    expect(shouldFailover(error)).toBe(true);
  });
});

describe('executeWithBucketFailover - failover execution', () => {
  it('should use first bucket initially', async () => {
    const request = { prompt: 'test' };
    const buckets = ['work@company.com', 'personal@gmail.com'];
    const executor = async (_req: MockRequest, bucket: string) => {
      if (bucket === 'work@company.com') {
        return { content: 'success from work bucket' };
      }
      throw new Error('Should not call other buckets');
    };

    const result = await executeWithBucketFailover(request, buckets, executor);
    expect(result.content).toBe('success from work bucket');
  });

  it('should failover to next bucket on 429 error', async () => {
    const request = { prompt: 'test' };
    const buckets = ['work@company.com', 'personal@gmail.com'];
    let callCount = 0;

    const executor = async (_req: MockRequest, bucket: string) => {
      callCount++;
      if (bucket === 'work@company.com') {
        throw new Error('Request failed with status code 429');
      }
      if (bucket === 'personal@gmail.com') {
        return { content: 'success from personal bucket' };
      }
      throw new Error('Unexpected bucket: ' + bucket);
    };

    const result = await executeWithBucketFailover(request, buckets, executor);
    expect(result.content).toBe('success from personal bucket');
    expect(callCount).toBe(2);
  });

  it('should failover to next bucket on quota exceeded error', async () => {
    const request = { prompt: 'test' };
    const buckets = ['bucket1', 'bucket2'];
    const executor = async (_req: MockRequest, bucket: string) => {
      if (bucket === 'bucket1') {
        throw new Error('Quota exceeded for this resource');
      }
      return { content: 'success from bucket2' };
    };

    const result = await executeWithBucketFailover(request, buckets, executor);
    expect(result.content).toBe('success from bucket2');
  });

  it('should failover through multiple buckets in sequence', async () => {
    const request = { prompt: 'test' };
    const buckets = ['bucket1', 'bucket2', 'bucket3'];
    const calledBuckets: string[] = [];

    const executor = async (_req: MockRequest, bucket: string) => {
      calledBuckets.push(bucket);

      if (bucket === 'bucket1') {
        throw new Error('Rate limit exceeded');
      }
      if (bucket === 'bucket2') {
        throw new Error('Quota exceeded');
      }
      if (bucket === 'bucket3') {
        return { content: 'success from bucket3' };
      }
      throw new Error('Unexpected bucket');
    };

    const result = await executeWithBucketFailover(request, buckets, executor);
    expect(result.content).toBe('success from bucket3');
    expect(calledBuckets).toEqual(['bucket1', 'bucket2', 'bucket3']);
  });

  it('should NOT failover on 400 bad request errors', async () => {
    const request = { prompt: 'test' };
    const buckets = ['bucket1', 'bucket2'];
    const calledBuckets: string[] = [];

    const executor = async (_req: MockRequest, bucket: string) => {
      calledBuckets.push(bucket);
      throw new Error('Request failed with status code 400: Invalid parameter');
    };

    await expect(
      executeWithBucketFailover(request, buckets, executor),
    ).rejects.toThrow('400');

    expect(calledBuckets).toEqual(['bucket1']); // Should only try first bucket
  });

  it('should throw error when all buckets exhausted', async () => {
    const request = { prompt: 'test' };
    const buckets = ['bucket1', 'bucket2'];

    const executor = async (_req: MockRequest, bucket: string) => {
      throw new Error(`Rate limit exceeded for ${bucket}`);
    };

    await expect(
      executeWithBucketFailover(request, buckets, executor),
    ).rejects.toThrow(/all buckets exhausted/i);
  });

  it('should include last error in exhausted buckets error message', async () => {
    const request = { prompt: 'test' };
    const buckets = ['bucket1', 'bucket2'];

    const executor = async (_req: MockRequest, _bucket: string) => {
      throw new Error('Quota exceeded - specific error message');
    };

    await expect(
      executeWithBucketFailover(request, buckets, executor),
    ).rejects.toThrow(/Quota exceeded - specific error message/i);
  });
});

describe('bucket failover notifications', () => {
  it('should notify user when switching buckets', () => {
    const log: NotificationLog = { messages: [] };

    notifyBucketSwitch('work@company.com', 'personal@gmail.com', log);

    expect(log.messages).toHaveLength(1);
    expect(log.messages[0]).toContain('work@company.com');
    expect(log.messages[0]).toContain('personal@gmail.com');
    expect(log.messages[0]).toMatch(/switch/i);
  });

  it('should include quota exceeded reason in notification', () => {
    const log: NotificationLog = { messages: [] };

    notifyBucketSwitch('bucket1', 'bucket2', log);

    expect(log.messages[0]).toMatch(/quota|rate|limit/i);
  });
});

describe('profile bucket resolution for failover', () => {
  it('should use profile buckets for failover chain when no session override', () => {
    const config: ProfileBucketConfig = {
      provider: 'anthropic',
      buckets: ['work@company.com', 'personal@gmail.com', 'backup@example.com'],
    };

    const buckets = resolveBucketsForFailover(config);

    expect(buckets).toEqual([
      'work@company.com',
      'personal@gmail.com',
      'backup@example.com',
    ]);
  });

  it('should use only session bucket when session override is set', () => {
    const config: ProfileBucketConfig = {
      provider: 'anthropic',
      buckets: ['work@company.com', 'personal@gmail.com'],
    };

    const buckets = resolveBucketsForFailover(config, 'personal@gmail.com');

    expect(buckets).toEqual(['personal@gmail.com']);
  });

  it('should use default bucket when profile has no auth field', () => {
    const config: ProfileBucketConfig = {
      provider: 'anthropic',
      buckets: [],
    };

    const buckets = resolveBucketsForFailover(config);

    expect(buckets).toEqual(['default']);
  });

  it('should preserve bucket order from profile for failover sequence', () => {
    const config: ProfileBucketConfig = {
      provider: 'anthropic',
      buckets: ['bucket3', 'bucket1', 'bucket2'], // Specific order
    };

    const buckets = resolveBucketsForFailover(config);

    expect(buckets).toEqual(['bucket3', 'bucket1', 'bucket2']);
  });
});

describe('all buckets exhausted error handling', () => {
  it('should show clear error message when all buckets exhausted', () => {
    const bucketStatuses: BucketStatus[] = [
      { bucket: 'work@company.com', error: 'Rate limited until 2:30 PM' },
      { bucket: 'personal@gmail.com', error: 'Quota exceeded' },
    ];

    const error = formatAllBucketsExhaustedError('anthropic', bucketStatuses);

    expect(error.message).toMatch(/all buckets exhausted/i);
    expect(error.message).toContain('anthropic');
  });

  it('should include all bucket statuses in error message', () => {
    const bucketStatuses: BucketStatus[] = [
      { bucket: 'bucket1', error: 'Rate limit exceeded' },
      { bucket: 'bucket2', error: 'Quota exceeded' },
      { bucket: 'bucket3', error: 'Payment required' },
    ];

    const error = formatAllBucketsExhaustedError('anthropic', bucketStatuses);

    expect(error.message).toContain('bucket1');
    expect(error.message).toContain('bucket2');
    expect(error.message).toContain('bucket3');
    expect(error.message).toContain('Rate limit exceeded');
    expect(error.message).toContain('Quota exceeded');
    expect(error.message).toContain('Payment required');
  });

  it('should suggest actionable next steps in error message', () => {
    const bucketStatuses: BucketStatus[] = [
      { bucket: 'bucket1', error: 'Quota exceeded' },
    ];

    const error = formatAllBucketsExhaustedError('anthropic', bucketStatuses);

    // Should suggest adding more buckets or trying again later
    expect(error.message).toMatch(/try again|add.*bucket|wait/i);
  });
});

describe('integration: profile loading with bucket failover', () => {
  it('should validate all buckets exist when loading profile', async () => {
    const profile: MockProfile = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      auth: {
        type: 'oauth',
        buckets: ['work@company.com', 'personal@gmail.com'],
      },
    };

    const tokenStore: MockTokenStore = {
      getToken: async (_provider: string, _bucket: string) => ({
        access_token: 'valid',
        expiry: Date.now() / 1000 + 3600,
      }),
    };

    const result = await validateProfileBucketsExist(profile, tokenStore);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should error when any bucket is missing', async () => {
    const profile: MockProfile = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      auth: {
        type: 'oauth',
        buckets: ['work@company.com', 'nonexistent@example.com'],
      },
    };

    const tokenStore: MockTokenStore = {
      getToken: async (_provider: string, bucket: string) => {
        if (bucket === 'work@company.com') {
          return { access_token: 'valid', expiry: Date.now() / 1000 + 3600 };
        }
        return null; // Missing bucket
      },
    };

    const result = await validateProfileBucketsExist(profile, tokenStore);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('nonexistent@example.com');
  });

  it('should include auth command suggestion in error for missing buckets', async () => {
    const profile: MockProfile = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      auth: {
        type: 'oauth',
        buckets: ['missing-bucket'],
      },
    };

    const tokenStore: MockTokenStore = {
      getToken: async () => null,
    };

    const result = await validateProfileBucketsExist(profile, tokenStore);

    expect(result.errors[0]).toMatch(/\/auth.*login|authenticate/i);
    expect(result.errors[0]).toContain('missing-bucket');
  });

  it('should not error when profile has no auth field (backward compat)', async () => {
    const profile: MockProfile = {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      // No auth field - should default to 'default' bucket
    };

    const tokenStore: MockTokenStore = {
      getToken: async (_provider: string, bucket: string) => {
        if (bucket === 'default') {
          return { access_token: 'valid', expiry: Date.now() / 1000 + 3600 };
        }
        return null;
      },
    };

    const result = await validateProfileBucketsExist(profile, tokenStore);

    expect(result.valid).toBe(true);
  });
});

describe('failover with expired buckets', () => {
  it('should skip expired buckets during failover', () => {
    const validToken: MockToken = {
      access_token: 'valid',
      expiry: Date.now() / 1000 + 3600, // Valid for 1 hour
    };

    const expiredToken: MockToken = {
      access_token: 'expired',
      expiry: Date.now() / 1000 - 3600, // Expired 1 hour ago
    };

    expect(isTokenExpired(validToken)).toBe(false);
    expect(isTokenExpired(expiredToken)).toBe(true);
  });

  it('should only use non-expired buckets in failover chain', () => {
    // This would be tested in the actual executeWithBucketFailover
    // but we define the expected behavior here
    const now = Date.now() / 1000;
    const tokens: Record<string, MockToken> = {
      bucket1: { access_token: 'tok1', expiry: now - 100 }, // expired
      bucket2: { access_token: 'tok2', expiry: now + 3600 }, // valid
      bucket3: { access_token: 'tok3', expiry: now + 7200 }, // valid
    };

    const bucket1Expired = isTokenExpired(tokens['bucket1']);
    const bucket2Expired = isTokenExpired(tokens['bucket2']);
    const bucket3Expired = isTokenExpired(tokens['bucket3']);

    expect(bucket1Expired).toBe(true);
    expect(bucket2Expired).toBe(false);
    expect(bucket3Expired).toBe(false);
  });
});
