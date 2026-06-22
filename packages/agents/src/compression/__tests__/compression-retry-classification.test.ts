/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-CR-001, REQ-CR-002
 *
 * Behavioral tests for compression error classification (isTransient /
 * shouldRetry) and property-based coverage. Extracted from the original
 * monolithic compression-retry.test.ts.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  isTransientCompressionError,
  shouldRetryCompressionError,
  CompressionExecutionError,
  CompressionStrategyError,
  UnknownStrategyError,
  PromptResolutionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import {
  makeHttpError,
  makeNetworkError,
  makeAnthropicOverloadError,
  makeAnthropicSdkWrappedError,
} from './compression-retry-helpers.js';

// ---------------------------------------------------------------------------
// Phase 1: isTransientCompressionError
// ---------------------------------------------------------------------------

describe('isTransientCompressionError @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  /**
   * @requirement REQ-CR-001
   * HTTP 429 is transient
   */
  it('returns true for HTTP 429 rate limit error', () => {
    expect(isTransientCompressionError(makeHttpError(429))).toBe(true);
  });

  /**
   * @requirement REQ-CR-001
   * HTTP 500-599 are transient server errors
   */
  it('returns true for HTTP 500 server error', () => {
    expect(isTransientCompressionError(makeHttpError(500))).toBe(true);
  });

  it('returns true for HTTP 503 service unavailable', () => {
    expect(isTransientCompressionError(makeHttpError(503))).toBe(true);
  });

  it('returns true for HTTP 502 bad gateway', () => {
    expect(isTransientCompressionError(makeHttpError(502))).toBe(true);
  });

  /**
   * @requirement REQ-CR-001
   * Network errors are transient
   */
  it('returns true for ECONNRESET network error', () => {
    expect(isTransientCompressionError(makeNetworkError('ECONNRESET'))).toBe(
      true,
    );
  });

  it('returns true for ETIMEDOUT network error', () => {
    expect(isTransientCompressionError(makeNetworkError('ETIMEDOUT'))).toBe(
      true,
    );
  });

  it('returns true for error with "connection reset" message', () => {
    const err = new Error('connection reset by peer');
    expect(isTransientCompressionError(err)).toBe(true);
  });

  it('returns true for error with "network timeout" message', () => {
    const err = new Error('network timeout');
    expect(isTransientCompressionError(err)).toBe(true);
  });

  /**
   * @requirement REQ-CR-001
   * Anthropic overload errors (no HTTP status) are transient.
   * Issue #2045: compression failed with overloaded_error and was not retried.
   */
  it('returns true for Anthropic overloaded_error (no HTTP status)', () => {
    expect(
      isTransientCompressionError(
        makeAnthropicOverloadError('overloaded_error'),
      ),
    ).toBe(true);
  });

  it('returns true for Anthropic rate_limit_error (no HTTP status)', () => {
    expect(
      isTransientCompressionError(
        makeAnthropicOverloadError('rate_limit_error', 'Rate limited'),
      ),
    ).toBe(true);
  });

  /**
   * @requirement REQ-CR-001
   * Anthropic api_error (Internal server error) carries no HTTP status but is
   * transient and must be retried. Issue #2053: api_error broke the agent loop
   * and failed compression because it was not classified as retryable.
   */
  it('returns true for Anthropic api_error internal server error (no HTTP status)', () => {
    expect(
      isTransientCompressionError(
        makeAnthropicOverloadError('api_error', 'Internal server error'),
      ),
    ).toBe(true);
  });

  /**
   * @requirement REQ-CR-001
   * The Anthropic SDK wraps stream error events so the retryable type is nested
   * at error.error.error.type. This is the shape that actually reaches
   * compression retry classification in production (issue #2053).
   */
  it('returns true for SDK-wrapped Anthropic api_error (nested, no HTTP status)', () => {
    expect(
      isTransientCompressionError(
        makeAnthropicSdkWrappedError('api_error', 'Internal server error'),
      ),
    ).toBe(true);
  });

  /**
   * @requirement REQ-CR-001
   * Permanent errors classified correctly
   */
  it('returns false for COMPRESSION_FAILED_INFLATED_TOKEN_COUNT (permanent)', () => {
    const err = new CompressionStrategyError(
      'Compression inflated token count',
      'COMPRESSION_FAILED_INFLATED_TOKEN_COUNT',
    );
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for CompressionExecutionError with EXECUTION_FAILED code (permanent)', () => {
    const err = new CompressionExecutionError('middle-out', 'some failure');
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for PromptResolutionError (permanent)', () => {
    const err = new PromptResolutionError('compress-prompt');
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for UnknownStrategyError (permanent)', () => {
    const err = new UnknownStrategyError('nonexistent-strategy');
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for HTTP 400 bad request (permanent)', () => {
    expect(isTransientCompressionError(makeHttpError(400))).toBe(false);
  });

  it('returns false for HTTP 401 unauthorized (permanent)', () => {
    expect(isTransientCompressionError(makeHttpError(401))).toBe(false);
  });

  it('returns false for generic programming error (permanent)', () => {
    const err = new TypeError('Cannot read property of undefined');
    expect(isTransientCompressionError(err)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTransientCompressionError(null)).toBe(false);
  });

  it('returns false for string error', () => {
    expect(isTransientCompressionError('some error message')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 1: shouldRetryCompressionError
// ---------------------------------------------------------------------------

describe('shouldRetryCompressionError @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  /**
   * @requirement REQ-CR-002
   * Should retry transient errors
   */
  it('returns true for HTTP 429', () => {
    expect(shouldRetryCompressionError(makeHttpError(429))).toBe(true);
  });

  it('returns true for HTTP 500', () => {
    expect(shouldRetryCompressionError(makeHttpError(500))).toBe(true);
  });

  it('returns true for ECONNRESET', () => {
    expect(shouldRetryCompressionError(makeNetworkError('ECONNRESET'))).toBe(
      true,
    );
  });

  /**
   * @requirement REQ-CR-002
   * Issue #2045: overload/rate-limit errors should trigger a retry.
   */
  it('returns true for Anthropic overloaded_error', () => {
    expect(
      shouldRetryCompressionError(
        makeAnthropicOverloadError('overloaded_error'),
      ),
    ).toBe(true);
  });

  it('returns true for Anthropic rate_limit_error', () => {
    expect(
      shouldRetryCompressionError(
        makeAnthropicOverloadError('rate_limit_error', 'Rate limited'),
      ),
    ).toBe(true);
  });

  /**
   * @requirement REQ-CR-002
   * Should not retry permanent errors
   */
  it('returns false for CompressionExecutionError', () => {
    const err = new CompressionExecutionError(
      'middle-out',
      'permanent failure',
    );
    expect(shouldRetryCompressionError(err)).toBe(false);
  });

  it('returns false for PromptResolutionError', () => {
    const err = new PromptResolutionError('prompt-id');
    expect(shouldRetryCompressionError(err)).toBe(false);
  });

  it('returns false for UnknownStrategyError', () => {
    const err = new UnknownStrategyError('bad-strategy');
    expect(shouldRetryCompressionError(err)).toBe(false);
  });

  it('returns false for HTTP 400', () => {
    expect(shouldRetryCompressionError(makeHttpError(400))).toBe(false);
  });

  it('returns true for CompressionExecutionError with isTransient: true', () => {
    const err = new CompressionExecutionError('middle-out', 'empty summary', {
      isTransient: true,
    });
    expect(shouldRetryCompressionError(err)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Phase 1: CompressionExecutionError.isTransient property
// ---------------------------------------------------------------------------

describe('CompressionExecutionError.isTransient @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  /**
   * @requirement REQ-CR-001
   * isTransient property reflects transience classification
   */
  it('has isTransient: false by default (permanent execution failure)', () => {
    const err = new CompressionExecutionError('middle-out', 'failed');
    expect(err.isTransient).toBe(false);
  });

  it('has isTransient: true when explicitly set', () => {
    const err = new CompressionExecutionError('middle-out', 'rate limited', {
      isTransient: true,
    });
    expect(err.isTransient).toBe(true);
  });

  it('has isTransient: false when explicitly set to false', () => {
    const err = new CompressionExecutionError('middle-out', 'auth error', {
      isTransient: false,
    });
    expect(err.isTransient).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (≥ 30% of total tests)
// ---------------------------------------------------------------------------

describe('Property-based: error classification @plan PLAN-20260218-COMPRESSION-RETRY.P01', () => {
  /**
   * @requirement REQ-CR-001
   * 5xx status codes are always transient
   */
  it('all 5xx status codes are transient', () => {
    fc.assert(
      fc.property(fc.integer({ min: 500, max: 599 }), (status) => {
        expect(isTransientCompressionError(makeHttpError(status))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * @requirement REQ-CR-001
   * 4xx (except 429) are permanent
   */
  it('4xx status codes except 429 are not transient', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 428 }), (status) => {
        expect(isTransientCompressionError(makeHttpError(status))).toBe(false);
      }),
      { numRuns: 29 },
    );
  });

  it('4xx status codes 430-499 are not transient', () => {
    fc.assert(
      fc.property(fc.integer({ min: 430, max: 499 }), (status) => {
        expect(isTransientCompressionError(makeHttpError(status))).toBe(false);
      }),
      { numRuns: 70 },
    );
  });

  /**
   * @requirement REQ-CR-002
   * shouldRetry mirrors isTransient for all error types
   */
  it('shouldRetryCompressionError returns same as isTransientCompressionError', () => {
    fc.assert(
      fc.property(fc.integer({ min: 400, max: 599 }), (status) => {
        const err = makeHttpError(status);
        expect(shouldRetryCompressionError(err)).toBe(
          isTransientCompressionError(err),
        );
      }),
      { numRuns: 200 },
    );
  });

  /**
   * @requirement REQ-CR-001
   * CompressionStrategyError subclasses are never transient
   */
  it('CompressionStrategyError subclasses are always non-transient', () => {
    const permanentErrors = [
      new CompressionExecutionError('s', 'cause'),
      new PromptResolutionError('pid'),
      new UnknownStrategyError('bad'),
      new CompressionStrategyError('msg', 'EXECUTION_FAILED'),
      new CompressionStrategyError('msg', 'PROMPT_RESOLUTION_FAILED'),
      new CompressionStrategyError('msg', 'UNKNOWN_STRATEGY'),
      new CompressionStrategyError(
        'msg',
        'COMPRESSION_FAILED_INFLATED_TOKEN_COUNT',
      ),
    ];

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: permanentErrors.length - 1 }),
        (idx) => {
          expect(isTransientCompressionError(permanentErrors[idx])).toBe(false);
          expect(shouldRetryCompressionError(permanentErrors[idx])).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });
});
