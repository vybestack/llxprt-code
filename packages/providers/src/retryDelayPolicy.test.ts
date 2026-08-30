/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  shouldRetryError,
  getDelayDuration,
  getRetryAfterDelayMs,
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

  it('reads Retry-After from an Anthropic-shaped error with Fetch Headers', () => {
    // Mirrors Anthropic.APIError's surface (status + top-level headers)
    // without constructing the SDK class in tests.
    const error = {
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
    };
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

  it('honors an explicit Retry-After: 0 as an immediate retry', () => {
    const error = {
      status: 429,
      headers: { 'retry-after': '0' },
    };
    expect(hasRetryAfterHeader(error)).toBe(true);
    expect(getRetryAfterDelayMs(error)).toBe(0);
    expect(getDelayDuration(error, 5000)).toBe(0);
  });

  it('treats a past Retry-After HTTP-date as present with zero delay', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();
    const error = {
      status: 503,
      headers: { 'retry-after': past },
    };
    expect(hasRetryAfterHeader(error)).toBe(true);
    expect(getRetryAfterDelayMs(error)).toBe(0);
    expect(getDelayDuration(error, 5000)).toBe(0);
  });

  it('treats a missing or unparseable Retry-After as absent', () => {
    expect(getRetryAfterDelayMs({ status: 429 })).toBeUndefined();
    expect(hasRetryAfterHeader({ status: 429 })).toBe(false);
    const unparseable = { status: 429, headers: { 'retry-after': 'soon' } };
    expect(getRetryAfterDelayMs(unparseable)).toBeUndefined();
    expect(hasRetryAfterHeader(unparseable)).toBe(false);
    const absentDelay = getDelayDuration({ status: 429 }, 4000);
    expect(absentDelay).toBeGreaterThanOrEqual(2800);
    expect(absentDelay).toBeLessThanOrEqual(5200);
  });

  it('rejects partially parsed delta-seconds values', () => {
    // RFC 9110 delta-seconds must be entirely digits: prefixes, fractions,
    // and signed values must fall back to the default backoff, never
    // produce a delay from the numeric prefix.
    for (const malformed of ['5seconds', '1.5', '-1', '+5', ' ']) {
      const error = {
        status: 429,
        headers: { 'retry-after': malformed },
      };
      expect(getRetryAfterDelayMs(error)).toBeUndefined();
      expect(hasRetryAfterHeader(error)).toBe(false);
      const delay = getDelayDuration(error, 4000);
      expect(delay).toBeGreaterThanOrEqual(2800);
      expect(delay).toBeLessThanOrEqual(5200);
    }
  });

  it('accepts a fully numeric delta-seconds value with surrounding whitespace', () => {
    const error = {
      status: 429,
      headers: { 'retry-after': ' 7 ' },
    };
    expect(getRetryAfterDelayMs(error)).toBe(7000);
    expect(getDelayDuration(error, 5000)).toBe(7000);
  });

  it('accepts a future Retry-After HTTP-date', () => {
    const future = new Date(Date.now() + 30_000).toUTCString();
    const error = {
      status: 503,
      headers: { 'retry-after': future },
    };
    expect(hasRetryAfterHeader(error)).toBe(true);
    const delay = getRetryAfterDelayMs(error);
    expect(delay).toBeGreaterThan(25_000);
    expect(delay).toBeLessThanOrEqual(30_000);
  });
});
