/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { shouldRetryError } from '../retryDelayPolicy.js';
import { RequestTimeoutError } from '../loadBalancing/streamTimeout.js';
import {
  MalformedStreamEventError,
  StreamTruncatedError,
} from '../streamProtocolErrors.js';
import {
  decodeRetryFailure,
  isRetryableFailure,
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

const mappingCases: FailureCase[] = [
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
  {
    label: 'Anthropic overloaded_error body with 529 status',
    error: Object.assign(anthropicError('overloaded_error'), {
      status: 529,
    }),
    expected: {
      phase: 'stream',
      kind: 'overload',
      status: 529,
      providerCode: 'overloaded_error',
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

describe('isRetryableFailure', () => {
  it.each(mappingCases)('matches shouldRetryError for $label', ({ error }) => {
    const failure = decodeRetryFailure(error);

    expect(isRetryableFailure(failure)).toBe(shouldRetryError(error));
  });

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

  it('decides eligibility from the full failure: 401 retries, 403 does not', () => {
    const unauthorized = errorWithStatus(401);
    const forbidden = errorWithStatus(403);

    expect(decodeRetryFailure(unauthorized).kind).toBe('auth');
    expect(decodeRetryFailure(forbidden).kind).toBe('auth');
    expect(isRetryableFailure(decodeRetryFailure(unauthorized))).toBe(true);
    expect(isRetryableFailure(decodeRetryFailure(forbidden))).toBe(false);
  });

  it('decides eligibility from the full failure: terminal-quota 429 does not retry', () => {
    const terminalQuota = Object.assign(errorWithStatus(429), {
      code: 'insufficient_quota',
    });

    expect(decodeRetryFailure(terminalQuota).kind).toBe('rate_limit');
    expect(decodeRetryFailure(terminalQuota).providerCode).toBe(
      'insufficient_quota',
    );
    expect(isRetryableFailure(decodeRetryFailure(terminalQuota))).toBe(false);
  });

  it('keeps terminal 403 auth status authoritative over provider body codes (issue #2917)', () => {
    const bodyApiError = Object.assign(errorWithStatus(403), {
      error: { type: 'api_error', message: 'Forbidden' },
    });

    const failure = decodeRetryFailure(bodyApiError);
    expect(failure.kind).toBe('auth');
    expect(failure.status).toBe(403);
    expect(failure.providerCode).toBe('api_error');
    expect(isRetryableFailure(failure)).toBe(false);
  });

  it('keeps terminal 404 status authoritative over a rate_limit_error body (issue #3140)', () => {
    const bodyRateLimit = Object.assign(errorWithStatus(404), {
      error: { type: 'rate_limit_error', message: 'Not found' },
    });

    const failure = decodeRetryFailure(bodyRateLimit);
    expect(failure.kind).toBe('invalid_request');
    expect(failure.status).toBe(404);
    expect(failure.providerCode).toBe('rate_limit_error');
    expect(isRetryableFailure(failure)).toBe(false);
  });

  it('still lets transient statuses defer to the provider body code (529 overload)', () => {
    const bodyOverload = Object.assign(errorWithStatus(529), {
      error: { type: 'overloaded_error', message: 'Overloaded' },
    });

    const failure = decodeRetryFailure(bodyOverload);
    expect(failure.kind).toBe('overload');
    expect(failure.status).toBe(529);
    expect(isRetryableFailure(failure)).toBe(true);
  });

  it('passes through provider codes from every production error position', () => {
    const openAiEnvelope = Object.assign(errorWithStatus(429), {
      error: { code: 'insufficient_quota' },
    });
    const liftedProviderType = Object.assign(errorWithStatus(400), {
      providerErrorType: 'invalid_request_error',
    });
    const detailEnvelope = Object.assign(errorWithStatus(500), {
      detail: { code: 'server_busy' },
    });

    expect(decodeRetryFailure(openAiEnvelope).providerCode).toBe(
      'insufficient_quota',
    );
    expect(decodeRetryFailure(liftedProviderType).providerCode).toBe(
      'invalid_request_error',
    );
    expect(decodeRetryFailure(detailEnvelope).providerCode).toBe('server_busy');
  });

  it('honors aggregate failure retryability markers over kind defaults', () => {
    const retryableAggregate = Object.assign(new Error('aggregate'), {
      failures: [errorWithStatus(503)],
      isRetryable: true,
    });
    const exhaustedAggregate = Object.assign(new Error('aggregate'), {
      failures: [errorWithStatus(503)],
      isRetryable: false,
    });

    expect(isRetryableFailure(decodeRetryFailure(retryableAggregate))).toBe(
      true,
    );
    expect(isRetryableFailure(decodeRetryFailure(exhaustedAggregate))).toBe(
      false,
    );
  });

  it('keeps load-balancer request timeouts outside orchestrator retry', () => {
    const lbTimeout = new RequestTimeoutError(500);

    const failure = decodeRetryFailure(lbTimeout);
    expect(failure.kind).toBe('timeout');
    expect(isRetryableFailure(failure)).toBe(false);
  });

  it('agrees with shouldRetryError across representative error shapes', () => {
    const representative: unknown[] = [
      errorWithStatus(400),
      errorWithStatus(404),
      errorWithStatus(422),
      errorWithStatus(429),
      errorWithStatus(500),
      errorWithStatus(503),
      errorWithStatus(401),
      errorWithStatus(403),
      errorWithStatus(402),
      Object.assign(errorWithStatus(429), { code: 'insufficient_quota' }),
      { name: 'AbortError', message: 'aborted' },
      new Error('ECONNRESET style transient'),
      new RequestTimeoutError(250),
      new StreamTruncatedError(),
      new MalformedStreamEventError('input_json_delta without tool block'),
    ];

    for (const error of representative) {
      expect(isRetryableFailure(decodeRetryFailure(error))).toBe(
        shouldRetryError(error),
      );
    }
  });
});
