/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core';
import type { ToolSchedulerContract } from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  SessionLifecycle,
  type SessionLifecyclePlan,
} from '../sessionLifecycle.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

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

function action(log: string[], name: string): () => void {
  return () => {
    log.push(name);
  };
}

function requireAggregate(error: unknown): AggregateError {
  if (!(error instanceof AggregateError)) {
    throw new Error('Expected disposal to reject with AggregateError');
  }
  return error;
}

function requireObject(value: unknown, label: string): object {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return value;
}

function internalTaskManager(agent: object): AsyncTaskManager {
  const deps = requireObject(Reflect.get(agent, 'deps'), 'AgentImpl deps');
  const services = requireObject(
    Reflect.get(deps, 'taskServices'),
    'session task services',
  );
  const manager: unknown = Reflect.get(services, 'manager');
  if (!(manager instanceof AsyncTaskManager)) {
    throw new Error('AgentImpl has no session task manager');
  }
  return manager;
}

function asyncTaskSubscriptionCount(manager: AsyncTaskManager): number {
  const emitter: unknown = Reflect.get(manager, 'emitter');
  if (!(emitter instanceof EventEmitter)) {
    throw new Error('AsyncTaskManager has no event emitter');
  }
  return emitter
    .eventNames()
    .reduce((count, event) => count + emitter.listenerCount(event), 0);
}

async function flushMicrotasks(): Promise<void> {
  for (let iteration = 0; iteration < 6; iteration += 1) {
    await Promise.resolve();
  }
}

function replaceCleanup(
  target: object,
  name: string,
  action: () => void,
): void {
  Object.defineProperty(target, name, { value: action, configurable: true });
}

describe('session lifecycle shutdown', () => {
  it('closes admissions before aborting waits, joins owned work before recording flush, and releases resources last', async () => {
    const calls: string[] = [];
    const joinStarted = deferred();
    const joinBarrier = deferred();
    const lifecycle = new SessionLifecycle({
      stopAdmissions: [action(calls, 'stop-admissions')],
      abortActiveAndPending: [action(calls, 'abort-waits')],
      cancelAndJoinOwnedWork: [
        async () => {
          calls.push('join-start');
          joinStarted.resolve();
          await joinBarrier.promise;
          calls.push('join-end');
        },
      ],
      flushRecording: [action(calls, 'flush-recording')],
      releaseResources: [action(calls, 'release-resources')],
    });

    const disposal = lifecycle.dispose();

    expect(() => lifecycle.assertAccepting()).toThrow(
      'Session is disposing or disposed',
    );
    await joinStarted.promise;
    expect(calls).toStrictEqual([
      'stop-admissions',
      'abort-waits',
      'join-start',
    ]);

    joinBarrier.resolve();
    await disposal;

    expect(calls).toStrictEqual([
      'stop-admissions',
      'abort-waits',
      'join-start',
      'join-end',
      'flush-recording',
      'release-resources',
    ]);
  });

  it('shares one cleanup attempt across concurrent and repeated disposal calls', async () => {
    const calls: string[] = [];
    const joinBarrier = deferred();
    const lifecycle = new SessionLifecycle({
      stopAdmissions: [action(calls, 'stop')],
      abortActiveAndPending: [action(calls, 'abort')],
      cancelAndJoinOwnedWork: [
        async () => {
          calls.push('join');
          await joinBarrier.promise;
        },
      ],
      flushRecording: [action(calls, 'flush')],
      releaseResources: [action(calls, 'release')],
    });

    const first = lifecycle.dispose();
    const concurrent = lifecycle.dispose();
    expect(concurrent).toBe(first);

    joinBarrier.resolve();
    await first;
    const repeated = lifecycle.dispose();
    expect(repeated).toBe(first);
    await repeated;

    expect(calls).toStrictEqual(['stop', 'abort', 'join', 'flush', 'release']);
  });

  it('attempts every action and aggregates the original failure objects', async () => {
    const calls: string[] = [];
    const abortFailure = new Error('abort failed');
    const taskFailure = { source: 'task', code: 17 };
    const recordingFailure = new Error('recording failed');
    const schedulerFailure = new Error('scheduler failed');
    const listenerFailure = new Error('listener failed');
    const plan: SessionLifecyclePlan = {
      stopAdmissions: [action(calls, 'stop')],
      abortActiveAndPending: [
        () => {
          calls.push('abort-failed');
          throw abortFailure;
        },
        action(calls, 'abort-survivor'),
      ],
      cancelAndJoinOwnedWork: [
        async () => {
          calls.push('task-failed');
          throw taskFailure;
        },
        action(calls, 'shell-survivor'),
      ],
      flushRecording: [
        () => {
          calls.push('recording-failed');
          throw recordingFailure;
        },
      ],
      releaseResources: [
        () => {
          calls.push('scheduler-failed');
          throw new AggregateError(
            [schedulerFailure],
            'scheduler cleanup failed',
          );
        },
        () => {
          calls.push('listener-failed');
          throw listenerFailure;
        },
        action(calls, 'final-survivor'),
      ],
    };
    const lifecycle = new SessionLifecycle(plan);

    const result = await lifecycle.dispose().catch((error: unknown) => error);
    const aggregate = requireAggregate(result);

    expect(calls).toStrictEqual([
      'stop',
      'abort-failed',
      'abort-survivor',
      'task-failed',
      'shell-survivor',
      'recording-failed',
      'scheduler-failed',
      'listener-failed',
      'final-survivor',
    ]);
    expect(aggregate.errors).toStrictEqual([
      abortFailure,
      taskFailure,
      recordingFailure,
      schedulerFailure,
      listenerFailure,
    ]);
  });

  it('shares the same aggregate rejection after cleanup has failed', async () => {
    const failure = new Error('release failed');
    const lifecycle = new SessionLifecycle({
      stopAdmissions: [],
      abortActiveAndPending: [],
      cancelAndJoinOwnedWork: [],
      flushRecording: [],
      releaseResources: [
        () => {
          throw failure;
        },
      ],
    });

    const firstPromise = lifecycle.dispose();
    const concurrentPromise = lifecycle.dispose();
    const first = requireAggregate(
      await firstPromise.catch((error: unknown) => error),
    );
    const concurrent = requireAggregate(
      await concurrentPromise.catch((error: unknown) => error),
    );
    const repeated = requireAggregate(
      await lifecycle.dispose().catch((error: unknown) => error),
    );

    expect(concurrent).toBe(first);
    expect(repeated).toBe(first);
    expect(first.errors).toStrictEqual([failure]);
  });

  it('publishes the disposal promise before cleanup actions can reenter dispose', async () => {
    let reentrant: Promise<void> | undefined;
    const lifecycle = new SessionLifecycle({
      stopAdmissions: [
        () => {
          reentrant = lifecycle.dispose();
        },
      ],
      abortActiveAndPending: [],
      cancelAndJoinOwnedWork: [],
      flushRecording: [],
      releaseResources: [],
    });

    const first = lifecycle.dispose();

    expect(reentrant).toBe(first);
    await first;
  });

  it('cancels and joins owned work without waiting for pending scheduler creation', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    let resolveScheduler = (_scheduler: ToolSchedulerContract): void => {
      throw new Error('Scheduler factory resolver was not initialized');
    };
    const schedulerCreation = new Promise<ToolSchedulerContract>((resolve) => {
      resolveScheduler = resolve;
    });
    let schedulerCancelCount = 0;
    let schedulerDisposeCount = 0;
    const scheduler: ToolSchedulerContract = {
      schedule: async () => undefined,
      cancelAll: () => {
        schedulerCancelCount += 1;
      },
      dispose: () => {
        schedulerDisposeCount += 1;
      },
      setCallbacks: () => undefined,
      handleConfirmationResponse: async () => undefined,
    };
    const pendingScheduler = Object.assign(schedulerCreation, scheduler);
    let agent: Agent | undefined;
    let acquisition: Promise<unknown> | undefined;
    let disposal: Promise<void> | undefined;
    const joinBarrier = deferred();

    try {
      agent = await fromConfig({
        config: built.config,
        messageBus: built.messageBus,
        toolSchedulerFactory: () => pendingScheduler,
      });
      const manager = internalTaskManager(agent);
      const taskController = new AbortController();
      let joinStarted = false;
      const execution = new Promise<void>((resolve) => {
        taskController.signal.addEventListener(
          'abort',
          () => {
            joinStarted = true;
            void joinBarrier.promise.then(resolve);
          },
          { once: true },
        );
      });
      manager.registerTask({
        id: 'owned-during-pending-scheduler-creation',
        subagentName: 'worker',
        goalPrompt: 'wait for session disposal',
        abortController: taskController,
      });
      manager.trackExecution(
        'owned-during-pending-scheduler-creation',
        execution,
      );
      agent.tasks.setupAutoTrigger(
        () => false,
        async () => undefined,
      );
      expect(asyncTaskSubscriptionCount(manager)).toBeGreaterThan(0);

      acquisition = agent.scheduler.acquire(
        { label: 'indefinitely-pending-factory' },
        'session',
        {
          getPreferredEditor: () => undefined,
          onEditorClose: () => undefined,
        },
        undefined,
        {
          messageBus: built.messageBus,
          toolRegistry: built.config.getToolRegistry(),
        },
      );
      void acquisition.catch(() => undefined);
      await flushMicrotasks();

      disposal = agent.dispose();
      let disposalSettled = false;
      void disposal.then(
        () => {
          disposalSettled = true;
        },
        () => {
          disposalSettled = true;
        },
      );
      await flushMicrotasks();

      expect(taskController.signal.aborted).toBe(true);
      expect(joinStarted).toBe(true);
      expect(manager.getRunningTasks()).toHaveLength(0);
      expect(asyncTaskSubscriptionCount(manager)).toBe(0);
      expect(schedulerCancelCount).toBe(0);
      expect(schedulerDisposeCount).toBe(0);
      expect(disposalSettled).toBe(false);

      resolveScheduler(scheduler);
      joinBarrier.resolve();
      await acquisition;
      await disposal;

      expect(schedulerCancelCount).toBe(1);
      expect(schedulerDisposeCount).toBe(1);
    } finally {
      resolveScheduler(scheduler);
      joinBarrier.resolve();
      await Promise.allSettled([
        ...(acquisition === undefined ? [] : [acquisition]),
        ...(disposal === undefined ? [] : [disposal]),
        ...(agent === undefined ? [] : [agent.dispose()]),
      ]);
      await built.cleanup();
    }
  });

  it('AgentImpl attempts task, recording, scheduler, and resource cleanup failures in one disposal', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const calls: string[] = [];
    const taskFailure = new Error('task cancellation failed');
    const recordingFailure = new Error('recording flush failed');
    const schedulerFailure = new Error('scheduler disposal failed');
    const resourceFailure = new Error('resource release failed');
    const scheduler: ToolSchedulerContract = {
      schedule: async () => undefined,
      cancelAll: () => undefined,
      dispose: () => {
        calls.push('scheduler');
        throw schedulerFailure;
      },
      setCallbacks: () => undefined,
      handleConfirmationResponse: async () => undefined,
    };
    try {
      const agent = await fromConfig({
        config: built.config,
        messageBus: built.messageBus,
        toolSchedulerFactory: () => scheduler,
      });
      const manager = internalTaskManager(agent);
      manager.registerTask({
        id: 'failing-cancellation',
        subagentName: 'worker',
        goalPrompt: 'wait for disposal',
        abortController: new AbortController(),
      });
      manager.onTaskCancelled(() => {
        calls.push('task');
        throw taskFailure;
      });
      await agent.scheduler.acquire(
        { label: 'failing-scheduler' },
        'session',
        {
          getPreferredEditor: () => undefined,
          onEditorClose: () => undefined,
        },
        undefined,
        {
          messageBus: built.messageBus,
          toolRegistry: built.config.getToolRegistry(),
        },
      );
      replaceCleanup(agent.session, 'dispose', () => {
        calls.push('recording');
        throw recordingFailure;
      });
      const deps = requireObject(Reflect.get(agent, 'deps'), 'AgentImpl deps');
      const runtimeHandle = requireObject(
        Reflect.get(deps, 'runtimeHandle'),
        'runtime handle',
      );
      replaceCleanup(runtimeHandle, 'cleanup', () => {
        calls.push('resource');
        throw resourceFailure;
      });

      const result = await agent.dispose().catch((error: unknown) => error);
      const aggregate = requireAggregate(result);

      expect(calls).toStrictEqual([
        'task',
        'recording',
        'scheduler',
        'resource',
      ]);
      expect(aggregate.errors).toStrictEqual([
        taskFailure,
        recordingFailure,
        schedulerFailure,
        resourceFailure,
      ]);
    } finally {
      await built.cleanup();
    }
  });
});
