/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for the post-#3048 turn retry policy (REQ-3048-002/003/004).
 *
 * `shouldRetryStreamAttempt` now takes a `StreamAttemptContext` that makes the
 * post-output status explicit. Before output the classification is bit-for-bit
 * identical to the pre-#3048 contract. After output only a transient transport
 * failure (`isNetworkTransientError`) that is not an abort may restart the turn,
 * and only within the existing bounded budget. The behaviour table below is the
 * complete enumeration from `analysis/pseudocode/001-turn-retry-policy.md`.
 */

import { describe, expect, it } from '../testApi.js';
import {
  shouldRetryStreamAttempt,
  applyRetryTemperature,
} from './turnAbortHelpers.js';
import type { SendMessageParams } from './chatSession.js';
import {
  InvalidStreamError,
  EmptyStreamError,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';

const baseParams: SendMessageParams = {
  message: [],
};

function paramsWithAbortSignal(aborted: boolean): SendMessageParams {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return {
    message: [],
    config: { abortSignal: controller.signal },
  };
}

interface PolicyRow {
  readonly name: string;
  readonly error: unknown;
  readonly attempt: number;
  readonly hasYieldedOutput: boolean;
  readonly params: SendMessageParams;
  readonly expected: boolean;
}

const policyTable: readonly PolicyRow[] = [
  {
    name: 'pre-output InvalidStreamError retries',
    error: new InvalidStreamError('no text', 'NO_RESPONSE_TEXT'),
    attempt: 0,
    hasYieldedOutput: false,
    params: baseParams,
    expected: true,
  },
  {
    name: 'pre-output EmptyStreamError retries',
    error: new EmptyStreamError('empty'),
    attempt: 0,
    hasYieldedOutput: false,
    params: baseParams,
    expected: true,
  },
  {
    name: 'pre-output InvalidStreamError with aborted signal does not retry',
    error: new InvalidStreamError('no text', 'NO_RESPONSE_TEXT'),
    attempt: 0,
    hasYieldedOutput: false,
    params: paramsWithAbortSignal(true),
    expected: false,
  },
  {
    name: 'pre-output EmptyStreamError with aborted signal does not retry',
    error: new EmptyStreamError('empty'),
    attempt: 0,
    hasYieldedOutput: false,
    params: paramsWithAbortSignal(true),
    expected: false,
  },
  {
    name: 'pre-output transient connection error retries',
    error: new Error('Connection error.'),
    attempt: 0,
    hasYieldedOutput: false,
    params: baseParams,
    expected: true,
  },
  {
    name: 'pre-output non-transient (400) does not retry',
    error: Object.assign(new Error('Bad request'), { status: 400 }),
    attempt: 0,
    hasYieldedOutput: false,
    params: baseParams,
    expected: false,
  },
  {
    name: 'post-output transient connection error restarts (new)',
    error: new Error('Connection error.'),
    attempt: 0,
    hasYieldedOutput: true,
    params: baseParams,
    expected: true,
  },
  {
    name: 'post-output transient connection error is bounded by budget',
    error: new Error('Connection error.'),
    attempt: 1,
    hasYieldedOutput: true,
    params: baseParams,
    expected: false,
  },
  {
    name: 'pre-output transient connection error is bounded by budget',
    error: new Error('Connection error.'),
    attempt: 1,
    hasYieldedOutput: false,
    params: baseParams,
    expected: false,
  },
  {
    name: 'post-output non-transient (400) does not restart',
    error: Object.assign(new Error('Bad request'), { status: 400 }),
    attempt: 0,
    hasYieldedOutput: true,
    params: baseParams,
    expected: false,
  },
  {
    name: 'post-output InvalidStreamError is not a transport failure (AD-3)',
    error: new InvalidStreamError('no text', 'NO_RESPONSE_TEXT'),
    attempt: 0,
    hasYieldedOutput: true,
    params: baseParams,
    expected: false,
  },
  {
    name: 'post-output EmptyStreamError is not a transport failure (AD-3)',
    error: new EmptyStreamError('empty'),
    attempt: 0,
    hasYieldedOutput: true,
    params: baseParams,
    expected: false,
  },
  {
    name: 'post-output AbortError name does not restart',
    error: Object.assign(new Error('Request aborted'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
    }),
    attempt: 0,
    hasYieldedOutput: true,
    params: baseParams,
    expected: false,
  },
  {
    name: 'post-output ABORT_ERR code does not restart',
    error: Object.assign(new Error('terminated'), { code: 'ABORT_ERR' }),
    attempt: 0,
    hasYieldedOutput: true,
    params: baseParams,
    expected: false,
  },
  {
    name: 'post-output transient phrase with aborted signal does not restart',
    error: new Error('terminated'),
    attempt: 0,
    hasYieldedOutput: true,
    params: paramsWithAbortSignal(true),
    expected: false,
  },
  {
    name: 'post-output terminal (isRetryable:false) aggregate does not restart',
    error: Object.assign(new Error('Retries exhausted'), {
      isRetryable: false,
    }),
    attempt: 0,
    hasYieldedOutput: true,
    params: baseParams,
    expected: false,
  },
];

describe('Turn retry policy discard-and-restart (issue 3048)', () => {
  it.each(policyTable)(
    '$name',
    ({ error, attempt, hasYieldedOutput, params, expected }) => {
      const result = shouldRetryStreamAttempt(error, params, attempt, {
        hasYieldedOutput,
      });
      expect(result).toBe(expected);
    },
  );

  it('exports applyRetryTemperature and returns params unchanged for attempt 0', () => {
    const params: SendMessageParams = {
      message: [],
      config: { temperature: 0.5 },
    };
    expect(applyRetryTemperature(params, 0)).toBe(params);
  });

  it('bumps temperature for attempt 1 within the clamped [0, 2] range', () => {
    const params: SendMessageParams = {
      message: [],
      config: { temperature: 0.5 },
    };
    const result = applyRetryTemperature(params, 1);
    expect(result).not.toBe(params);
    expect(result.config?.temperature).toBeCloseTo(1.1, 5);
  });

  it('clamps retry temperature to the upper bound', () => {
    const params: SendMessageParams = {
      message: [],
      config: { temperature: 1.9 },
    };
    expect(applyRetryTemperature(params, 1).config?.temperature).toBe(2);
  });
});
