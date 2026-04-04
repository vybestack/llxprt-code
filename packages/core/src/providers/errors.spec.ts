/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan issue1871
 * Tests for AllBucketsExhaustedError status propagation and message cleaning
 */

import { describe, it, expect } from 'vitest';
import {
  AllBucketsExhaustedError,
  type BucketFailureReason,
} from '../providers/errors.js';

describe('AllBucketsExhaustedError', () => {
  describe('status propagation', () => {
    it('should propagate status from lastError (HTTP 429)', () => {
      const lastError = new Error('Rate limited');
      (lastError as { status?: number }).status = 429;

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default', 'vybestack'],
        lastError,
      );

      expect(error.status).toBe(429);
    });

    it('should propagate status from lastError (HTTP 401)', () => {
      const lastError = new Error('Unauthorized');
      (lastError as { status?: number }).status = 401;

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default'],
        lastError,
      );

      expect(error.status).toBe(401);
    });

    it('should have undefined status when lastError has no status', () => {
      const lastError = new Error('Some error');

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default'],
        lastError,
      );

      expect(error.status).toBeUndefined();
    });
  });

  describe('message cleaning - Anthropic JSON extraction', () => {
    it('should extract human-readable message from Anthropic JSON error (rate_limit_error)', () => {
      const lastError = new Error(
        '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_011CZfeKcTxKGqdUFdsszVVW"}',
      );
      (lastError as { status?: number }).status = 429;

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default', 'claudius', 'vybestack'],
        lastError,
        {
          default: 'skipped',
          claudius: 'skipped',
          vybestack: 'quota-exhausted',
        },
      );

      expect(error.message).toContain(
        "This request would exceed your account's rate limit. Please try again later.",
      );
      expect(error.message).not.toContain('"type":"error"');
      expect(error.message).not.toContain('request_id');
    });

    it('should extract human-readable message from Anthropic JSON error (overloaded_error)', () => {
      const lastError = new Error(
        '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_123"}',
      );

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default'],
        lastError,
      );

      expect(error.message).toContain('Overloaded');
      expect(error.message).not.toContain('"type":"error"');
    });

    it('should preserve original message when no JSON present', () => {
      const lastError = new Error('Plain error message');

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default'],
        lastError,
      );

      expect(error.message).toContain('Plain error message');
    });

    it('should preserve original message when JSON is invalid', () => {
      const lastError = new Error('429 {invalid json}');

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default'],
        lastError,
      );

      expect(error.message).toContain('429 {invalid json}');
    });

    it('should handle message with status code prefix', () => {
      const lastError = new Error(
        'API Error: 403 {"type":"error","error":{"type":"permission_error","message":"OAuth token has been revoked."}}',
      );

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default'],
        lastError,
      );

      expect(error.message).toContain('OAuth token has been revoked.');
    });
  });

  describe('basic error properties', () => {
    it('should have correct name', () => {
      const lastError = new Error('Some error');

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default'],
        lastError,
      );

      expect(error.name).toBe('AllBucketsExhaustedError');
    });

    it('should store attempted buckets', () => {
      const lastError = new Error('Some error');
      const buckets = ['bucket1', 'bucket2', 'bucket3'];

      const error = new AllBucketsExhaustedError(
        'anthropic',
        buckets,
        lastError,
      );

      expect(error.attemptedBuckets).toEqual(buckets);
      // Verify it's a copy, not the same reference
      expect(error.attemptedBuckets).not.toBe(buckets);
    });

    it('should store lastError', () => {
      const lastError = new Error('Original error');

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default'],
        lastError,
      );

      expect(error.lastError).toBe(lastError);
    });

    it('should store bucket failure reasons', () => {
      const lastError = new Error('Some error');
      const reasons: Record<string, BucketFailureReason> = {
        bucket1: 'quota-exhausted',
        bucket2: 'expired-refresh-failed',
      };

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['bucket1', 'bucket2'],
        lastError,
        reasons,
      );

      expect(error.bucketFailureReasons).toEqual(reasons);
    });

    it('should include bucket details in message when failure reasons provided', () => {
      const lastError = new Error('Rate limited');

      const error = new AllBucketsExhaustedError(
        'anthropic',
        ['default', 'vybestack'],
        lastError,
        {
          default: 'skipped',
          vybestack: 'quota-exhausted',
        },
      );

      expect(error.message).toContain('default: skipped');
      expect(error.message).toContain('vybestack: quota-exhausted');
    });
  });
});
