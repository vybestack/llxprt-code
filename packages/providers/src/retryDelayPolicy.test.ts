/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import Anthropic from '@anthropic-ai/sdk';
import {
  shouldRetryError,
  getDelayDuration,
  hasRetryAfterHeader,
} from './retryDelayPolicy.js';

describe('shouldRetryError @issue:3140', () => {
  it('returns false for a quota-exhaustion 429 (terminal)', () => {
    const error = {
      status: 429,
      error: { code: 'insufficient_quota' },
    };
    expect(shouldRetryError(error)).toBe(false);
  });

  it('returns false for billing_hard_limit_reached 429 (terminal)', () => {
    const error = {
      status: 429,
      error: { code: 'billing_hard_limit_reached' },
    };
    expect(shouldRetryError(error)).toBe(false);
  });

  it('returns false for a 429 carrying insufficient_quota only under type', () => {
    const error = {
      status: 429,
      type: 'insufficient_quota',
    };
    expect(shouldRetryError(error)).toBe(false);
  });

  it('returns true for a throttling 429 (rate_limit_exceeded)', () => {
    const error = {
      status: 429,
      error: { code: 'rate_limit_exceeded' },
    };
    expect(shouldRetryError(error)).toBe(true);
  });

  it('returns true for a bare 429 with no body code', () => {
    const error = {
      status: 429,
      message: 'Too many requests',
    };
    expect(shouldRetryError(error)).toBe(true);
  });

  it('returns true for a 5xx server error', () => {
    const error = {
      status: 500,
      error: { message: 'Internal error' },
    };
    expect(shouldRetryError(error)).toBe(true);
  });

  it('returns false for a 400 bad request', () => {
    const error = {
      status: 400,
      error: { message: 'Bad request' },
    };
    expect(shouldRetryError(error)).toBe(false);
  });
});

describe('getDelayDuration / hasRetryAfterHeader @issue:3140', () => {
  it('honors Retry-After header when present', () => {
    const error = {
      status: 429,
      response: { headers: { 'retry-after': '2' } },
    };
    expect(hasRetryAfterHeader(error)).toBe(true);
    expect(getDelayDuration(error, 5000)).toBe(2000);
  });

  it('caps Retry-After at the 5 minute maximum', () => {
    const error = {
      status: 429,
      response: { headers: { 'retry-after': '600' } },
    };
    expect(getDelayDuration(error, 5000)).toBe(300_000);
  });

  it('falls back to jittered exponential backoff when no Retry-After', () => {
    const error = { status: 429 };
    const delayMs = getDelayDuration(error, 4000);
    // jitter is ±30%, so the result is within [4000 - 1200, 4000 + 1200]
    expect(delayMs).toBeGreaterThanOrEqual(2800);
    expect(delayMs).toBeLessThanOrEqual(5200);
  });

  it('reads Retry-After from a real Anthropic SDK APIError', () => {
    const error = new Anthropic.APIError(
      429,
      { message: 'rate limited' },
      'rate limited',
      new Headers({ 'retry-after': '2' }),
    );
    expect(hasRetryAfterHeader(error)).toBe(true);
    expect(getDelayDuration(error, 5000)).toBe(2000);
  });

  it('reads Retry-After from a Fetch Headers object on response', () => {
    const error = {
      status: 429,
      response: { headers: new Headers({ 'Retry-After': '3' }) },
    };
    expect(getDelayDuration(error, 5000)).toBe(3000);
  });

  it('reads Retry-After from mixed-case plain header objects', () => {
    const error = {
      status: 429,
      headers: { 'Retry-After': '4' },
    };
    expect(getDelayDuration(error, 5000)).toBe(4000);
  });
});
