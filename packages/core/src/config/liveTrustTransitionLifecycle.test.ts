/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  LiveTrustTransitionLifecycle,
  type LiveTrustTransitionDependencies,
} from './liveTrustTransitionLifecycle.js';

function createDependencies(
  overrides: Partial<LiveTrustTransitionDependencies> = {},
): LiveTrustTransitionDependencies {
  return {
    downgradeApprovalMode: vi.fn(),
    removeTrustedPolicyRules: vi.fn(),
    updateTrustPolicy: vi.fn(),
    transitionMcp: vi.fn().mockResolvedValue(undefined),
    initializeHooks: vi.fn().mockResolvedValue(undefined),
    emitTrustChanged: vi.fn(),
    ...overrides,
  };
}

async function captureAggregateError(
  promise: Promise<void>,
): Promise<AggregateError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AggregateError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an AggregateError');
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((error: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const resolve = (value: T): void => {
    if (resolvePromise === undefined) {
      throw new Error('Deferred promise was not initialized');
    }
    resolvePromise(value);
  };
  const reject = (error: unknown): void => {
    if (rejectPromise === undefined) {
      throw new Error('Deferred promise was not initialized');
    }
    rejectPromise(error);
  };
  return { promise, resolve, reject };
}

describe('LiveTrustTransitionLifecycle', () => {
  it('runs no transition side effects after disposal begins', async () => {
    const dependencies = createDependencies();
    const lifecycle = new LiveTrustTransitionLifecycle(dependencies);
    lifecycle.beginDisposal();

    lifecycle.apply(false);
    await lifecycle.whenSettled();

    expect(dependencies.downgradeApprovalMode).not.toHaveBeenCalled();
    expect(dependencies.removeTrustedPolicyRules).not.toHaveBeenCalled();
    expect(dependencies.updateTrustPolicy).not.toHaveBeenCalled();
    expect(dependencies.transitionMcp).not.toHaveBeenCalled();
    expect(dependencies.initializeHooks).not.toHaveBeenCalled();
    expect(dependencies.emitTrustChanged).not.toHaveBeenCalled();
  });

  it('reports every synchronous failure in a transition batch', async () => {
    const transitionCount = 101;
    const dependencies = createDependencies({
      removeTrustedPolicyRules: vi.fn(() => {
        throw new Error('policy removal failed');
      }),
    });
    const lifecycle = new LiveTrustTransitionLifecycle(dependencies);

    for (let index = 0; index < transitionCount; index++) {
      lifecycle.apply(true);
    }

    const failure = await captureAggregateError(lifecycle.whenSettled());

    expect(failure.errors).toHaveLength(transitionCount);
  });

  it('skips queued phases after disposal while reporting a running failure', async () => {
    const firstTransitionStarted = createDeferred<void>();
    const firstTransition = createDeferred<void>();
    const transitionFailure = new Error('running transition failed');
    const dependencies = createDependencies({
      transitionMcp: vi.fn(() => {
        firstTransitionStarted.resolve(undefined);
        return firstTransition.promise;
      }),
    });
    const lifecycle = new LiveTrustTransitionLifecycle(dependencies);
    lifecycle.apply(true);
    await firstTransitionStarted.promise;
    lifecycle.apply(false);

    lifecycle.beginDisposal();
    firstTransition.reject(transitionFailure);

    await expect(lifecycle.whenSettled()).rejects.toBe(transitionFailure);
    expect(dependencies.transitionMcp).toHaveBeenCalledTimes(1);
    expect(dependencies.initializeHooks).not.toHaveBeenCalled();
  });

  it('reports a failed batch to concurrent waiters and releases it afterward', async () => {
    const transitionStarted = createDeferred<void>();
    const transition = createDeferred<void>();
    const transitionFailure = new Error('transition failed');
    const dependencies = createDependencies({
      transitionMcp: vi.fn(() => {
        transitionStarted.resolve(undefined);
        return transition.promise;
      }),
    });
    const lifecycle = new LiveTrustTransitionLifecycle(dependencies);
    lifecycle.apply(true);
    const firstWaiter = lifecycle.whenSettled();
    const secondWaiter = lifecycle.whenSettled();
    await transitionStarted.promise;

    transition.reject(transitionFailure);

    await expect(firstWaiter).rejects.toBe(transitionFailure);
    await expect(secondWaiter).rejects.toBe(transitionFailure);
    await expect(lifecycle.whenSettled()).resolves.toBeUndefined();
  });

  it('reports every unconsumed failure in the captured snapshot to concurrent waiters without waiting for later work', async () => {
    const firstFailure = new Error('first transition failed');
    const secondFailure = new Error('second transition failed');
    const firstHooksStarted = createDeferred<void>();
    const secondTransitionStarted = createDeferred<void>();
    const secondTransition = createDeferred<void>();
    const laterTransition = createDeferred<void>();
    const dependencies = createDependencies({
      transitionMcp: vi
        .fn()
        .mockRejectedValueOnce(firstFailure)
        .mockImplementationOnce(() => {
          secondTransitionStarted.resolve(undefined);
          return secondTransition.promise;
        })
        .mockImplementationOnce(() => laterTransition.promise),
      initializeHooks: vi.fn().mockImplementation(() => {
        firstHooksStarted.resolve(undefined);
        return Promise.resolve();
      }),
    });
    const lifecycle = new LiveTrustTransitionLifecycle(dependencies);

    lifecycle.apply(true);
    await firstHooksStarted.promise;

    lifecycle.apply(true);
    const firstWaiter = captureAggregateError(lifecycle.whenSettled());
    const secondWaiter = captureAggregateError(lifecycle.whenSettled());
    lifecycle.apply(true);
    await secondTransitionStarted.promise;

    secondTransition.reject(secondFailure);

    const firstReport = await firstWaiter;
    const secondReport = await secondWaiter;
    expect(firstReport).toBe(secondReport);
    expect(firstReport.errors).toStrictEqual([firstFailure, secondFailure]);

    laterTransition.resolve(undefined);
    await expect(lifecycle.whenSettled()).resolves.toBeUndefined();
  });
});
