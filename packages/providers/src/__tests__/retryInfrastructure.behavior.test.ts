/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerateChatOptions } from '../IProvider.js';
import { rethrowIfAborted } from '../loadBalancing/requestAbort.js';
import {
  classifyRetryError,
  isTerminalRetryError,
  markErrorAfterStreamOutput,
} from '../retryErrorClassification.js';
import { resolveRetryRequestContext } from '../retryRequestContext.js';
import {
  attachTransportAttemptBudget,
  consumeTransportAttempt,
} from '../transportAttemptBudget.js';
import { closeIteratorBeforeContinuing } from '../utils/streamCleanup.js';

const defaults = {
  maxAttempts: 4,
  initialDelayMs: 25,
  authRetryTimeoutMs: 500,
};

function optionsWithEphemerals(
  ephemerals: Record<string, unknown>,
): GenerateChatOptions {
  return {
    contents: [],
    invocation: { ephemerals } as GenerateChatOptions['invocation'],
  };
}

describe('request-scoped retry infrastructure', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares a budget through nested wrappers without mutating reusable caller context', () => {
    const callerContext: Record<string, unknown> = { requestLabel: 'caller' };
    const originalOptions: GenerateChatOptions = {
      contents: [],
      metadata: { _retryRequestContext: callerContext },
    };

    const firstRequest = attachTransportAttemptBudget(originalOptions, 2);
    expect(consumeTransportAttempt(firstRequest.options)).toBe(true);
    const nestedWrapper = attachTransportAttemptBudget(
      firstRequest.options,
      99,
    );
    const independentRequest = attachTransportAttemptBudget(originalOptions, 2);

    expect(nestedWrapper.budget).toBe(firstRequest.budget);
    expect(nestedWrapper.budget.used).toBe(1);
    expect(independentRequest.budget).not.toBe(firstRequest.budget);
    expect(independentRequest.budget.used).toBe(0);
    expect(callerContext).toStrictEqual({ requestLabel: 'caller' });
    expect(originalOptions.metadata?._retryRequestContext).toBe(callerContext);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'bounds non-finite transport limit %s to one attempt',
    (limit) => {
      const { options, budget } = attachTransportAttemptBudget(
        { contents: [] },
        limit,
      );

      expect(budget).toStrictEqual({ limit: 1, used: 0 });
      expect(consumeTransportAttempt(options)).toBe(true);
      expect(consumeTransportAttempt(options)).toBe(false);
    },
  );

  it('falls back from invalid retry counts and delay settings', () => {
    const request = resolveRetryRequestContext(
      optionsWithEphemerals({
        retries: Number.POSITIVE_INFINITY,
        retrywait: Number.NaN,
        'auth-retry-timeout': -1,
      }),
      defaults,
    );

    expect(request.maxAttempts).toBe(defaults.maxAttempts);
    expect(request.initialDelayMs).toBe(defaults.initialDelayMs);
    expect(request.authRetryTimeoutMs).toBe(defaults.authRetryTimeoutMs);
    expect(request.budget.limit).toBe(defaults.maxAttempts);
  });

  it('accepts zero for delay settings while normalizing fractional attempts', () => {
    const request = resolveRetryRequestContext(
      optionsWithEphemerals({
        retries: 2.9,
        retrywait: 0,
        'auth-retry-timeout': 0,
      }),
      defaults,
    );

    expect(request.maxAttempts).toBe(2);
    expect(request.initialDelayMs).toBe(0);
    expect(request.authRetryTimeoutMs).toBe(0);
  });

  it('treats an explicit client status as authoritative for retry classification', () => {
    const error = Object.assign(new Error('socket hang up'), {
      status: 400,
      code: 'ECONNRESET',
    });

    expect(classifyRetryError(error)).toMatchObject({
      category: 'client_error',
      isNetworkError: false,
    });
  });

  it('classifies primitive retry errors safely and preserves object error identity', () => {
    expect(isTerminalRetryError(null)).toBe(false);
    expect(isTerminalRetryError('provider failed')).toBe(false);

    const frozenError = Object.freeze(new Error('midstream failure'));
    expect(markErrorAfterStreamOutput(frozenError)).toBe(frozenError);
    expect(isTerminalRetryError(frozenError)).toBe(true);

    const wrappedPrimitive = markErrorAfterStreamOutput('primitive failure');
    expect(wrappedPrimitive).toMatchObject({ cause: 'primitive failure' });
    expect(isTerminalRetryError(wrappedPrimitive)).toBe(true);
  });

  it('converts request cancellation to AbortError while retaining the provider failure', () => {
    const controller = new AbortController();
    const providerFailure = new Error('provider observed cancellation');
    controller.abort();

    expect(() =>
      rethrowIfAborted(providerFailure, {
        contents: [],
        metadata: { abortSignal: controller.signal },
      }),
    ).toThrowError(
      expect.objectContaining({
        name: 'AbortError',
        cause: providerFailure,
      }),
    );
  });

  it('contains synchronous iterator return failures', async () => {
    const iterator: AsyncIterator<unknown> = {
      next: async () => ({ done: true, value: undefined }),
      return: () => {
        throw new Error('synchronous return failure');
      },
    };

    await expect(
      closeIteratorBeforeContinuing(iterator, new Error('provider failure')),
    ).resolves.toBeUndefined();
  });

  it.each([new Error('original provider failure'), null, undefined])(
    'does not replace an existing provider failure %s when cleanup times out',
    async (failure) => {
      vi.useFakeTimers();
      const iterator: AsyncIterator<unknown> = {
        next: async () => ({ done: true, value: undefined }),
        return: () => new Promise(() => {}),
      };
      const cleanup = closeIteratorBeforeContinuing(iterator, failure, true);

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(cleanup).resolves.toBeUndefined();
    },
  );
});
