/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260223-ISSUE1598.P07
 * AllBucketsExhaustedError - Behavioral tests for error reporting
 *
 * BEHAVIORAL TESTS - Testing error construction and message formatting
 */

import { describe, it, expect } from 'vitest';
import {
  AllBucketsExhaustedError,
  type BucketFailureReason,
} from '../errors.js';

describe('AllBucketsExhaustedError @plan:PLAN-20260223-ISSUE1598.P07', () => {
  /**
   * @requirement REQ-1598-ER03
   * Backward compatibility: Construct with 3 params, verify bucketFailureReasons defaults to empty object
   */
  it('should construct with 3 parameters (backward compatibility)', () => {
    // Arrange
    const providerName = 'anthropic';
    const attemptedBuckets = ['bucket1', 'bucket2', 'bucket3'];
    const lastError = new Error('Rate limit exceeded');

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
    );

    // Assert
    expect(error).toBeInstanceOf(AllBucketsExhaustedError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AllBucketsExhaustedError');
    expect(error.attemptedBuckets).toEqual(attemptedBuckets);
    expect(error.lastError).toBe(lastError);
    expect(error.bucketFailureReasons).toEqual({});
  });

  /**
   * @requirement REQ-1598-ER01
   * With failure reasons: Construct with 4 params including reasons, verify bucketFailureReasons is set correctly
   */
  it('should construct with 4 parameters (with failure reasons)', () => {
    // Arrange
    const providerName = 'openai';
    const attemptedBuckets = ['bucket1', 'bucket2'];
    const lastError = new Error('Quota exhausted');
    const bucketFailureReasons: Record<string, BucketFailureReason> = {
      bucket1: 'quota-exhausted',
      bucket2: 'expired-refresh-failed',
    };

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
      bucketFailureReasons,
    );

    // Assert
    expect(error).toBeInstanceOf(AllBucketsExhaustedError);
    expect(error.attemptedBuckets).toEqual(attemptedBuckets);
    expect(error.lastError).toBe(lastError);
    expect(error.bucketFailureReasons).toEqual(bucketFailureReasons);
    expect(error.bucketFailureReasons.bucket1).toBe('quota-exhausted');
    expect(error.bucketFailureReasons.bucket2).toBe('expired-refresh-failed');
  });

  /**
   * @requirement REQ-1598-ER04
   * Human-readable message: Base format includes provider name and bucket list
   */
  it('should include provider name and attempted buckets in message', () => {
    // Arrange
    const providerName = 'google';
    const attemptedBuckets = ['bucket-alpha', 'bucket-beta', 'bucket-gamma'];
    const lastError = new Error('Authentication failed');

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
    );

    // Assert
    expect(error.message).toContain(providerName);
    expect(error.message).toContain('bucket-alpha');
    expect(error.message).toContain('bucket-beta');
    expect(error.message).toContain('bucket-gamma');
    expect(error.message).toMatch(
      /All buckets exhausted for provider 'google': bucket-alpha, bucket-beta, bucket-gamma/,
    );
  });

  /**
   * @requirement REQ-1598-ER02
   * Enhanced message: When reasons are provided, error message should include per-bucket failure details
   */
  it('should include per-bucket failure details in message when reasons provided', () => {
    // Arrange
    const providerName = 'anthropic';
    const attemptedBuckets = ['bucket1', 'bucket2', 'bucket3'];
    const lastError = new Error('All buckets failed');
    const bucketFailureReasons: Record<string, BucketFailureReason> = {
      bucket1: 'quota-exhausted',
      bucket2: 'expired-refresh-failed',
      bucket3: 'reauth-failed',
    };

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
      bucketFailureReasons,
    );

    // Assert - Enhanced message format
    expect(error.message).toContain('bucket1: quota-exhausted');
    expect(error.message).toContain('bucket2: expired-refresh-failed');
    expect(error.message).toContain('bucket3: reauth-failed');
  });

  /**
   * @requirement REQ-1598-ER02
   * Empty reasons: When empty reasons object provided, message should be the base format (no failure details section)
   */
  it('should use base message format when reasons object is empty', () => {
    // Arrange
    const providerName = 'openai';
    const attemptedBuckets = ['bucket1', 'bucket2'];
    const lastError = new Error('Final error');
    const emptyReasons: Record<string, BucketFailureReason> = {};

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
      emptyReasons,
    );

    // Assert - Should be base format without detail section
    expect(error.message).toContain(providerName);
    expect(error.message).toContain('bucket1');
    expect(error.message).toContain('bucket2');
    // Should NOT contain failure detail markers
    expect(error.message).not.toMatch(/quota-exhausted|expired-refresh-failed/);
  });

  /**
   * @requirement REQ-1598-ER03, REQ-1598-ER04
   * Edge case: Empty bucket list
   */
  it('should handle empty bucket list gracefully', () => {
    // Arrange
    const providerName = 'mistral';
    const attemptedBuckets: string[] = [];
    const lastError = new Error('No buckets available');

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
    );

    // Assert
    expect(error.attemptedBuckets).toEqual([]);
    expect(error.bucketFailureReasons).toEqual({});
    expect(error.message).toContain(providerName);
    expect(error.message).toMatch(/All buckets exhausted for provider/);
  });

  /**
   * @requirement REQ-1598-ER01
   * All possible failure reason types
   */
  it('should support all BucketFailureReason types', () => {
    // Arrange
    const providerName = 'anthropic';
    const attemptedBuckets = [
      'bucket1',
      'bucket2',
      'bucket3',
      'bucket4',
      'bucket5',
    ];
    const lastError = new Error('Comprehensive failure');
    const bucketFailureReasons: Record<string, BucketFailureReason> = {
      bucket1: 'quota-exhausted',
      bucket2: 'expired-refresh-failed',
      bucket3: 'reauth-failed',
      bucket4: 'no-token',
      bucket5: 'skipped',
    };

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
      bucketFailureReasons,
    );

    // Assert
    expect(error.bucketFailureReasons.bucket1).toBe('quota-exhausted');
    expect(error.bucketFailureReasons.bucket2).toBe('expired-refresh-failed');
    expect(error.bucketFailureReasons.bucket3).toBe('reauth-failed');
    expect(error.bucketFailureReasons.bucket4).toBe('no-token');
    expect(error.bucketFailureReasons.bucket5).toBe('skipped');
  });

  /**
   * @requirement REQ-1598-ER01, REQ-1598-ER03
   * Partial reasons: Some buckets have reasons, others don't
   */
  it('should handle partial failure reasons (some buckets missing reasons)', () => {
    // Arrange
    const providerName = 'cohere';
    const attemptedBuckets = ['bucket1', 'bucket2', 'bucket3'];
    const lastError = new Error('Partial info');
    const partialReasons: Record<string, BucketFailureReason> = {
      bucket1: 'quota-exhausted',
      bucket3: 'reauth-failed',
      // bucket2 missing
    };

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
      partialReasons,
    );

    // Assert
    expect(error.bucketFailureReasons.bucket1).toBe('quota-exhausted');
    expect(error.bucketFailureReasons.bucket2).toBeUndefined();
    expect(error.bucketFailureReasons.bucket3).toBe('reauth-failed');
  });

  /**
   * @requirement REQ-1598-ER04
   * Message should be immutable after construction
   */
  it('should have immutable message after construction', () => {
    // Arrange
    const providerName = 'openai';
    const attemptedBuckets = ['bucket1'];
    const lastError = new Error('Test');

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
    );
    const originalMessage = error.message;

    // Attempt to modify (should not affect message)
    error.attemptedBuckets.push('bucket2');

    // Assert
    expect(error.message).toBe(originalMessage);
  });

  /**
   * @requirement REQ-1598-ER03
   * Verify error properties are accessible
   */
  it('should expose all required properties publicly', () => {
    // Arrange
    const providerName = 'anthropic';
    const attemptedBuckets = ['bucket1', 'bucket2'];
    const lastError = new Error('Last attempt failed');
    const bucketFailureReasons: Record<string, BucketFailureReason> = {
      bucket1: 'quota-exhausted',
      bucket2: 'no-token',
    };

    // Act
    const error = new AllBucketsExhaustedError(
      providerName,
      attemptedBuckets,
      lastError,
      bucketFailureReasons,
    );

    // Assert - All properties should be readable
    expect(error.name).toBe('AllBucketsExhaustedError');
    expect(error.message).toBeTruthy();
    expect(error.attemptedBuckets).toBeDefined();
    expect(error.lastError).toBeDefined();
    expect(error.bucketFailureReasons).toBeDefined();
    expect(error.stack).toBeTruthy();
  });
});
