/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { shouldRetryError } from '../retryDelayPolicy.js';
import { RequestTimeoutError } from '../loadBalancing/streamTimeout.js';
import {
  isStreamTruncatedError,
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
  /**
   * Pinned pre-commit retryability of this shape, asserted literally so a
   * regression against intended policy fails the case instead of comparing
   * the implementation to itself.
   */
  readonly retryable: boolean;
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
    retryable: true,
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
    retryable: true,
  },
  {
    label: '5xx server response',
    error: errorWithStatus(503),
    expected: { phase: 'headers', kind: 'server', status: 503 },
    retryable: true,
  },
  {
    label: '401 authentication response',
    error: errorWithStatus(401),
    expected: { phase: 'auth', kind: 'auth', status: 401 },
    retryable: true,
  },
  {
    label: '403 authentication response',
    error: errorWithStatus(403),
    expected: { phase: 'auth', kind: 'auth', status: 403 },
    retryable: false,
  },
  {
    label: '402 payment response',
    error: errorWithStatus(402),
    expected: { phase: 'auth', kind: 'payment', status: 402 },
    retryable: false,
  },
  {
    label: '400 invalid request',
    error: errorWithStatus(400),
    expected: { phase: 'headers', kind: 'invalid_request', status: 400 },
    retryable: false,
  },
  {
    label: '404 invalid request',
    error: errorWithStatus(404),
    expected: { phase: 'headers', kind: 'invalid_request', status: 404 },
    retryable: false,
  },
  {
    label: '422 invalid request',
    error: errorWithStatus(422),
    expected: { phase: 'headers', kind: 'invalid_request', status: 422 },
    retryable: false,
  },
  {
    label: 'network transient',
    error: Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
    expected: { phase: 'connect', kind: 'network' },
    retryable: true,
  },
  {
    // Deliberate divergence: load-balancer request timeouts are governed by
    // the load balancer's own failover settings, not orchestrator retry.
    label: 'request timeout message',
    error: new Error('Request timeout after 1000ms'),
    expected: { phase: 'stream', kind: 'timeout' },
    retryable: false,
  },
  {
    label: 'stream timeout message',
    error: new Error('Stream timeout after 1000ms'),
    expected: { phase: 'stream', kind: 'timeout' },
    retryable: true,
  },
  {
    label: 'AbortError cancellation',
    error: new DOMException('request cancelled', 'AbortError'),
    expected: { phase: 'cancellation', kind: 'cancelled' },
    retryable: false,
  },
  {
    label: 'unknown error',
    error: new Error('unclassified provider failure'),
    expected: { phase: 'protocol', kind: 'unknown' },
    retryable: false,
  },
  {
    label: 'Anthropic overloaded_error body',
    error: anthropicError('overloaded_error'),
    expected: {
      phase: 'stream',
      kind: 'overload',
      providerCode: 'overloaded_error',
    },
    retryable: true,
  },
  {
    label: 'Anthropic rate_limit_error body',
    error: anthropicError('rate_limit_error'),
    expected: {
      phase: 'stream',
      kind: 'rate_limit',
      providerCode: 'rate_limit_error',
    },
    retryable: true,
  },
  {
    label: 'Anthropic api_error body',
    error: anthropicError('api_error'),
    expected: {
      phase: 'stream',
      kind: 'server',
      providerCode: 'api_error',
    },
    retryable: true,
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
    retryable: true,
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

  it('reports retryAfterMs 0 for an explicit Retry-After: 0', () => {
    const error = Object.assign(errorWithStatus(429), {
      response: { headers: { 'retry-after': '0' } },
    });

    expect(decodeRetryFailure(error).retryAfterMs).toBe(0);
  });

  it('omits retryAfterMs when no Retry-After header exists', () => {
    expect(
      decodeRetryFailure(errorWithStatus(429)).retryAfterMs,
    ).toBeUndefined();
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

  it('requires name and code markers to classify protocol stream errors', () => {
    // Only a shared name is not enough: an unrelated error that happens to
    // be named StreamTruncatedError must not decode as a truncated stream.
    const nameOnly = { name: 'StreamTruncatedError' };
    expect(isStreamTruncatedError(nameOnly)).toBe(false);
    expect(decodeRetryFailure(nameOnly).kind).toBe('unknown');

    // Cross-realm duck-typed instances carry both markers.
    const duckTyped = {
      name: 'StreamTruncatedError',
      code: 'LLXPRT_STREAM_TRUNCATED',
    };
    expect(isStreamTruncatedError(duckTyped)).toBe(true);
    expect(decodeRetryFailure(duckTyped).kind).toBe('truncated');
  });

  it('decodes through throwing getters without propagating them', () => {
    const hostile = {
      name: 'APIError',
      get error(): unknown {
        throw new Error('getter exploded');
      },
    };
    expect(() => decodeRetryFailure(hostile)).not.toThrow();

    // The Retry-After header walk must be equally total: a throwing
    // headers getter escapes through buildRetryFailure otherwise.
    const hostileHeaders = {
      name: 'APIError',
      get headers(): unknown {
        throw new Error('getter exploded');
      },
    };
    const failure = decodeRetryFailure(hostileHeaders);
    expect(failure.cause).toBe(hostileHeaders);
    expect(failure.retryAfterMs).toBeUndefined();
  });
});

describe('isRetryableFailure', () => {
  it.each(mappingCases)(
    'classifies $label as retryable=$retryable before commitment',
    ({ error, retryable }) => {
      expect(isRetryableFailure(decodeRetryFailure(error))).toBe(retryable);
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
      error: { code: 'insufficient_quota' },
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

  it('pins retryability for shapes outside the mapping table', () => {
    // Terminal-quota 429: rate_limit kind, but quota exhaustion is terminal.
    expect(
      isRetryableFailure(
        decodeRetryFailure(
          Object.assign(errorWithStatus(429), {
            error: { code: 'insufficient_quota' },
          }),
        ),
      ),
    ).toBe(false);
    // Name-only abort object (no DOMException class).
    expect(
      isRetryableFailure(
        decodeRetryFailure({ name: 'AbortError', message: 'aborted' }),
      ),
    ).toBe(false);
    // Message-only transient WITHOUT an errno code property: the classifier
    // still recognizes known transport phrases in the message itself.
    expect(
      isRetryableFailure(
        decodeRetryFailure(new Error('ECONNRESET style transient')),
      ),
    ).toBe(true);
    expect(
      isRetryableFailure(
        decodeRetryFailure(new Error('provider failed for no stated reason')),
      ),
    ).toBe(false);
    expect(
      isRetryableFailure(decodeRetryFailure(new StreamTruncatedError())),
    ).toBe(true);
    expect(
      isRetryableFailure(
        decodeRetryFailure(
          new MalformedStreamEventError('input_json_delta without tool block'),
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableFailure(decodeRetryFailure(new RequestTimeoutError(250))),
    ).toBe(false);
  });

  it('routes shouldRetryError through the taxonomy policy', () => {
    // shouldRetryError is the compatibility seam over isRetryableFailure;
    // these two assertions would catch it being re-derived independently.
    expect(shouldRetryError(errorWithStatus(503))).toBe(true);
    expect(shouldRetryError(errorWithStatus(403))).toBe(false);
  });

  it('never reports transport errno codes as provider codes', () => {
    const failure = decodeRetryFailure(
      Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }),
    );

    expect(failure.kind).toBe('network');
    expect(failure.providerCode).toBeUndefined();
  });
});
