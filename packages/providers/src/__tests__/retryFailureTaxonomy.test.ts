/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { shouldRetryError } from '../retryDelayPolicy.js';
import {
  decodeRetryFailure,
  isRetryableFailureKind,
  isTimeoutFailure,
  RETRYABLE_FAILURE_KINDS,
} from '../retryFailureTaxonomy.js';

interface FailureCase {
  readonly label: string;
  readonly error: unknown;
  readonly expected: Readonly<Record<string, unknown>>;
}

function errorWithStatus(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

function anthropicError(type: string): Readonly<Record<string, unknown>> {
  return {
    error: {
      type: 'error',
      error: { type, message: `Anthropic ${type}` },
    },
  };
}

const mappingCases: readonly FailureCase[] = [
  {
    label: '429 without Retry-After',
    error: errorWithStatus(429),
    expected: { phase: 'headers', kind: 'rate_limit', status: 429 },
  },
  {
    label: '429 with Retry-After',
    error: Object.assign(errorWithStatus(429), {
      response: { headers: { 'retry-after': '2' } },
    }),
    expected: {
      phase: 'headers',
      kind: 'rate_limit',
      status: 429,
      retryAfterMs: 2_000,
    },
  },
  {
    label: '5xx server response',
    error: errorWithStatus(503),
    expected: { phase: 'headers', kind: 'server', status: 503 },
  },
  {
    label: '401 authentication response',
    error: errorWithStatus(401),
    expected: { phase: 'auth', kind: 'auth', status: 401 },
  },
  {
    label: '403 authentication response',
    error: errorWithStatus(403),
    expected: { phase: 'auth', kind: 'auth', status: 403 },
  },
  {
    label: '402 payment response',
    error: errorWithStatus(402),
    expected: { phase: 'auth', kind: 'payment', status: 402 },
  },
  {
    label: '400 invalid request',
    error: errorWithStatus(400),
    expected: { phase: 'headers', kind: 'invalid_request', status: 400 },
  },
  {
    label: '404 invalid request',
    error: errorWithStatus(404),
    expected: { phase: 'headers', kind: 'invalid_request', status: 404 },
  },
  {
    label: '422 invalid request',
    error: errorWithStatus(422),
    expected: { phase: 'headers', kind: 'invalid_request', status: 422 },
  },
  {
    label: 'network transient',
    error: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
    expected: { phase: 'connect', kind: 'network' },
  },
  {
    label: 'stream timeout message',
    error: new Error('Stream timeout after 1000ms'),
    expected: { phase: 'stream', kind: 'timeout' },
  },
  {
    label: 'request timeout message',
    error: new Error('Request timeout after 1000ms'),
    expected: { phase: 'stream', kind: 'timeout' },
  },
  {
    label: 'AbortError cancellation',
    error: new DOMException('request cancelled', 'AbortError'),
    expected: { phase: 'cancellation', kind: 'cancelled' },
  },
  {
    label: 'unknown error',
    error: new Error('unclassified provider failure'),
    expected: { phase: 'protocol', kind: 'unknown' },
  },
  {
    label: 'Anthropic overloaded_error body',
    error: anthropicError('overloaded_error'),
    expected: {
      phase: 'stream',
      kind: 'overload',
      providerCode: 'overloaded_error',
    },
  },
  {
    label: 'Anthropic rate_limit_error body',
    error: anthropicError('rate_limit_error'),
    expected: {
      phase: 'stream',
      kind: 'rate_limit',
      providerCode: 'rate_limit_error',
    },
  },
  {
    label: 'Anthropic api_error body',
    error: anthropicError('api_error'),
    expected: {
      phase: 'stream',
      kind: 'server',
      providerCode: 'api_error',
    },
  },
];

describe('decodeRetryFailure', () => {
  it.each(mappingCases)(
    'maps $label into the shared taxonomy',
    ({ error, expected }) => {
      expect(decodeRetryFailure(error)).toMatchObject(expected);
    },
  );

  it('caps Retry-After using the existing delay policy', () => {
    const error = Object.assign(errorWithStatus(429), {
      response: { headers: { 'retry-after': '600' } },
    });

    expect(decodeRetryFailure(error).retryAfterMs).toBe(300_000);
  });

  it.each(mappingCases)(
    'attaches the original $label as its cause',
    ({ error }) => {
      expect(decodeRetryFailure(error).cause).toBe(error);
    },
  );

  it('identifies timeout failures', () => {
    const timeout = decodeRetryFailure(new Error('Stream timeout after 50ms'));
    const server = decodeRetryFailure(errorWithStatus(500));

    expect(isTimeoutFailure(timeout)).toBe(true);
    expect(isTimeoutFailure(server)).toBe(false);
  });
});

describe('isRetryableFailureKind', () => {
  const equivalenceCases = mappingCases.filter(
    ({ expected }) => expected.status !== 403,
  );

  it.each(equivalenceCases)(
    'matches shouldRetryError for $label',
    ({ error }) => {
      const failure = decodeRetryFailure(error);

      expect(isRetryableFailureKind(failure.kind)).toBe(
        shouldRetryError(error),
      );
    },
  );

  it('publishes the pre-commit retryable kinds', () => {
    expect([...RETRYABLE_FAILURE_KINDS]).toStrictEqual([
      'timeout',
      'network',
      'rate_limit',
      'overload',
      'server',
      'auth',
      'malformed',
      'truncated',
    ]);
  });

  it('documents the existing status-sensitive auth retry discrepancy', () => {
    const unauthorized = errorWithStatus(401);
    const forbidden = errorWithStatus(403);

    expect(decodeRetryFailure(unauthorized).kind).toBe('auth');
    expect(decodeRetryFailure(forbidden).kind).toBe('auth');
    expect(shouldRetryError(unauthorized)).toBe(true);
    expect(shouldRetryError(forbidden)).toBe(false);
    expect(isRetryableFailureKind('auth')).toBe(true);
  });

  it('documents the existing terminal-quota subtype discrepancy', () => {
    const terminalQuota = Object.assign(errorWithStatus(429), {
      code: 'insufficient_quota',
    });

    expect(decodeRetryFailure(terminalQuota).kind).toBe('rate_limit');
    expect(shouldRetryError(terminalQuota)).toBe(false);
    expect(isRetryableFailureKind('rate_limit')).toBe(true);
  });
});
