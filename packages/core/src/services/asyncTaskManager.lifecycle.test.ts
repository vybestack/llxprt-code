/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { AsyncTaskManager } from './asyncTaskManager.js';

type Deferred = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

function deferred(): Deferred {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
  };
}

describe('AsyncTaskManager lifecycle', () => {
  it('closes admissions, aborts running tasks, and joins tracked executions', async () => {
    const manager = new AsyncTaskManager(2);
    const controller = new AbortController();
    const executionBarrier = deferred();
    let joined = false;
    manager.registerTask({
      id: 'background-task',
      subagentName: 'worker',
      goalPrompt: 'wait for cancellation',
      abortController: controller,
    });
    manager.trackExecution(
      'background-task',
      executionBarrier.promise.finally(() => {
        joined = true;
      }),
    );

    const firstClose = manager.close();
    const concurrentClose = manager.close();

    expect(new Set([firstClose, concurrentClose]).size).toBe(1);
    expect(controller.signal.aborted).toBe(true);
    expect(manager.getTask('background-task')?.status).toBe('cancelled');
    expect(manager.canLaunchAsync()).toStrictEqual({
      allowed: false,
      reason: 'Async task manager is closed',
    });
    expect(() =>
      manager.registerTask({
        id: 'late-task',
        subagentName: 'worker',
        goalPrompt: 'too late',
        abortController: new AbortController(),
      }),
    ).toThrow('Async task manager is closed');
    await Promise.resolve();
    expect(joined).toBe(false);

    executionBarrier.resolve();
    await firstClose;

    expect(joined).toBe(true);
    expect(new Set([firstClose, concurrentClose, manager.close()]).size).toBe(
      1,
    );
  });

  it('waits for every tracked execution even when one rejects', async () => {
    const manager = new AsyncTaskManager(2);
    const firstBarrier = deferred();
    const secondBarrier = deferred();
    const firstFailure = new Error('first execution failed');
    const first = firstBarrier.promise.then(() => {
      throw firstFailure;
    });
    const second = secondBarrier.promise;
    manager.trackExecution('first', first);
    manager.trackExecution('second', second);

    const closing = manager.close();
    firstBarrier.resolve();
    await Promise.resolve();
    let completed = false;
    void closing.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );
    await Promise.resolve();
    expect(completed).toBe(false);

    secondBarrier.resolve();
    const result = await closing.catch((error: unknown) => error);

    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError)) {
      throw new Error('Expected close to reject with AggregateError');
    }
    expect(result.errors).toStrictEqual([firstFailure]);
  });

  it('joins every execution and retains cancellation failures when listeners throw', async () => {
    const manager = new AsyncTaskManager(2);
    const barrier = deferred();
    const cancellationFailure = new Error('cancellation listener failed');
    const executionFailure = new Error('execution failed');
    const controller = new AbortController();
    manager.registerTask({
      id: 'failure',
      subagentName: 'worker',
      goalPrompt: 'wait',
      abortController: controller,
    });
    manager.onTaskCancelled(() => {
      throw cancellationFailure;
    });
    manager.trackExecution(
      'failure',
      barrier.promise.then(() => {
        throw executionFailure;
      }),
    );

    const first = manager.close();
    expect(new Set([first, manager.close()]).size).toBe(1);
    expect(controller.signal.aborted).toBe(true);
    let settled = false;
    void first
      .finally(() => {
        settled = true;
      })
      .catch(() => undefined);
    await Promise.resolve();
    expect(settled).toBe(false);

    barrier.resolve();
    const result = await first.catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AggregateError);
    if (!(result instanceof AggregateError)) {
      throw new Error('Expected close to reject with AggregateError');
    }
    expect(result.errors).toStrictEqual([
      cancellationFailure,
      executionFailure,
    ]);
  });

  it('publishes the close promise before cancellation listeners reenter close', async () => {
    const manager = new AsyncTaskManager(1);
    const controller = new AbortController();
    let reentrant: Promise<void> | undefined;
    manager.registerTask({
      id: 'reentrant',
      subagentName: 'worker',
      goalPrompt: 'wait',
      abortController: controller,
    });
    manager.onTaskCancelled(() => {
      reentrant = manager.close();
    });

    const closing = manager.close();

    expect(reentrant).toBe(closing);
    await closing;
  });
});
