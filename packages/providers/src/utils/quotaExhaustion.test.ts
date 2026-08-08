/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { isQuotaExhaustionError } from './quotaExhaustion.js';

describe('isQuotaExhaustionError @issue:3140', () => {
  it('returns true for 429 with error.error.code insufficient_quota', () => {
    const error = {
      status: 429,
      error: { code: 'insufficient_quota' },
    };
    expect(isQuotaExhaustionError(error)).toBe(true);
  });

  it('returns true for 429 with error.error.type insufficient_quota', () => {
    const error = {
      status: 429,
      error: { type: 'insufficient_quota' },
    };
    expect(isQuotaExhaustionError(error)).toBe(true);
  });

  it('returns true for 429 with error.code billing_hard_limit_reached', () => {
    const error = {
      status: 429,
      code: 'billing_hard_limit_reached',
    };
    expect(isQuotaExhaustionError(error)).toBe(true);
  });

  it('returns true for 429 with error.type billing_hard_limit_reached', () => {
    const error = {
      status: 429,
      type: 'billing_hard_limit_reached',
    };
    expect(isQuotaExhaustionError(error)).toBe(true);
  });

  /**
   * The Codex / ChatGPT backend wraps its error payload in `detail` rather
   * than the standard OpenAI `error` envelope.
   */
  it('returns true for 429 with detail.code insufficient_quota', () => {
    const error = {
      status: 429,
      detail: { code: 'insufficient_quota' },
    };
    expect(isQuotaExhaustionError(error)).toBe(true);
  });

  it('returns true for 429 with detail.type insufficient_quota', () => {
    const error = {
      status: 429,
      detail: { type: 'insufficient_quota' },
    };
    expect(isQuotaExhaustionError(error)).toBe(true);
  });

  /**
   * parseErrorResponse lifts the body-level `type` onto `providerErrorType`
   * rather than `type`, so the classifier must read that position.
   */
  it('returns true for 429 with providerErrorType insufficient_quota', () => {
    const error = {
      status: 429,
      providerErrorType: 'insufficient_quota',
    };
    expect(isQuotaExhaustionError(error)).toBe(true);
  });

  it('returns false for 429 with rate_limit_exceeded code', () => {
    const error = {
      status: 429,
      error: { code: 'rate_limit_exceeded' },
    };
    expect(isQuotaExhaustionError(error)).toBe(false);
  });

  it('returns false for 429 with no code/type at all', () => {
    const error = {
      status: 429,
      message: 'Too many requests',
    };
    expect(isQuotaExhaustionError(error)).toBe(false);
  });

  it('returns false when status is not 429 even with a terminal code', () => {
    const error402 = {
      status: 402,
      error: { code: 'insufficient_quota' },
    };
    expect(isQuotaExhaustionError(error402)).toBe(false);

    const error500 = {
      status: 500,
      error: { code: 'insufficient_quota' },
    };
    expect(isQuotaExhaustionError(error500)).toBe(false);
  });

  it('returns false for non-object input', () => {
    expect(isQuotaExhaustionError(undefined)).toBe(false);
    expect(isQuotaExhaustionError(null)).toBe(false);
    expect(isQuotaExhaustionError('string error')).toBe(false);
    expect(isQuotaExhaustionError(42)).toBe(false);
  });

  it('returns false for an unrecognized terminal-looking code', () => {
    const error = {
      status: 429,
      error: { code: 'some_other_quota_thing' },
    };
    expect(isQuotaExhaustionError(error)).toBe(false);
  });
});
