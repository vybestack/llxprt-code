/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerateChatOptions } from '../IProvider.js';
import { permitsBucketFailover, RetriesExhaustedError } from '../errors.js';
import { rethrowIfAborted } from '../loadBalancing/requestAbort.js';
import { claimProviderErrorObservation } from '../providerErrorObservation.js';
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
import {
  createLinkedAbortController,
  raceWithAbort,
} from '../utils/abortSignal.js';
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

  it('admits no more concurrent consumers than the shared budget limit', async () => {
    const { options, budget } = attachTransportAttemptBudget(
      { contents: [] },
      2,
    );

    const admitted = await Promise.all(
      Array.from({ length: 8 }, async () => consumeTransportAttempt(options)),
    );

    expect(admitted.filter(Boolean)).toHaveLength(2);
    expect(budget.used).toBe(2);
  });

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

  it('normalizes a fractional default attempt count to a whole transport budget', () => {
    const request = resolveRetryRequestContext(optionsWithEphemerals({}), {
      ...defaults,
      maxAttempts: 3.9,
    });

    expect(request.maxAttempts).toBe(3);
    expect(request.budget.limit).toBe(3);
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

  it('prevents bucket failover after retry exhaustion', () => {
    const cause = new Error('last transport failed');
    const error = new RetriesExhaustedError(
      'transport budget exhausted',
      'server_error',
      { cause },
    );

    expect(permitsBucketFailover(error)).toBe(false);
  });

  it('claims the same unscoped error only once', () => {
    const options: GenerateChatOptions = {
      contents: [],
      onProviderError: () => undefined,
    };
    const error = new Error('delegate failure');

    expect(claimProviderErrorObservation(options, error)).toBe(true);
    expect(claimProviderErrorObservation(options, error)).toBe(false);
  });

  it('retains the abort reason when racing an operation', async () => {
    const controller = new AbortController();
    const reason = new Error('request deadline expired');
    controller.abort(reason);

    await expect(
      raceWithAbort(new Promise<void>(() => {}), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError', cause: reason });
  });

  it('allows linked attempt cleanup to be repeated and detaches from its parent', () => {
    const parent = new AbortController();
    const linked = createLinkedAbortController(parent.signal);

    linked.dispose();
    linked.dispose();
    parent.abort(new Error('parent stopped'));

    expect(linked.controller.signal.aborted).toBe(false);
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
