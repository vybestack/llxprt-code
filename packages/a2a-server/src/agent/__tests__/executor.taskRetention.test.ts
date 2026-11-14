/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The executor lives as long as the HTTP server, so it must not keep a task's
 * live session forever once the task can no longer run. Finished (failed,
 * canceled, completed) tasks are released after their final state is saved;
 * the task store stays authoritative, so a released task can still be fetched
 * and reconstructed by id.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { TaskState } from '@a2a-js/sdk';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { CoderAgentExecutor } from '../executor.js';
import type { acquireTaskSession } from '../task-session-owner.js';
import type { Task } from '../task.js';

type TurnScript = () => AsyncGenerator<AgentEvent, void, unknown>;

interface FakeSession {
  task: Task;
  disposed: () => boolean;
}

/** A session double that records disposal and plays a scripted turn. */
function createFakeSession(
  taskId: string,
  contextId: string,
  turn: TurnScript,
): FakeSession {
  let disposed = false;
  const task = {
    id: taskId,
    contextId,
    taskState: 'submitted' as TaskState,
    eventBus: undefined,
    acceptUserMessage: turn,
    setTaskStateAndPublishUpdate(state: TaskState): void {
      task.taskState = state;
    },
    cancelTurn(): void {},
    getMetadata: () => ({ id: taskId, taskState: task.taskState }),
    async dispose(): Promise<void> {
      disposed = true;
    },
  } as unknown as Task;
  return { task, disposed: () => disposed };
}

const eventBus = {
  publish: () => {},
  on: () => {},
  off: () => {},
  once: () => {},
  removeAllListeners: () => {},
  finished: () => {},
} as unknown as ExecutionEventBus;

function requestFor(taskId: string): RequestContext {
  return {
    userMessage: {
      role: 'user',
      parts: [{ kind: 'text', text: 'go' }],
      messageId: `m-${taskId}`,
      kind: 'message',
      contextId: 'ctx',
      taskId,
    },
  } as unknown as RequestContext;
}

describe('CoderAgentExecutor task retention', () => {
  let store: InMemoryTaskStore;
  let sessions: Map<string, FakeSession>;
  let turns: Map<string, TurnScript>;
  let executor: CoderAgentExecutor;

  const finishTurn: TurnScript = async function* () {
    yield { type: 'done', reason: 'stop' };
  };
  const failingTurn: TurnScript = async function* () {
    yield { type: 'done', reason: 'stop' };
    throw new Error('model exploded');
  };

  beforeEach(() => {
    store = new InMemoryTaskStore();
    sessions = new Map();
    turns = new Map();
    const createSession: typeof acquireTaskSession = async (
      taskId,
      contextId,
    ) => {
      const session = createFakeSession(
        taskId,
        contextId,
        turns.get(taskId) ?? finishTurn,
      );
      sessions.set(taskId, session);
      return session.task;
    };
    executor = new CoderAgentExecutor(store, createSession);
  });

  it('keeps a task that is waiting for the next user message', async () => {
    await executor.execute(requestFor('waiting'), eventBus);

    expect(executor.getTask('waiting')?.task.taskState).toBe('input-required');
    expect(sessions.get('waiting')?.disposed()).toBe(false);
  });

  it('releases and disposes a task whose turn failed, after saving it', async () => {
    turns.set('failed', failingTurn);

    await executor.execute(requestFor('failed'), eventBus);

    expect(executor.getTask('failed')).toBeUndefined();
    expect(executor.getAllTasks()).toStrictEqual([]);
    expect(sessions.get('failed')?.disposed()).toBe(true);
    expect((await store.load('failed'))?.status.state).toBe('failed');
  });

  it('releases and disposes a task once it is canceled', async () => {
    await executor.execute(requestFor('to-cancel'), eventBus);
    expect(executor.getTask('to-cancel')).toBeDefined();

    await executor.cancelTask('to-cancel', eventBus);

    expect(executor.getTask('to-cancel')).toBeUndefined();
    expect(sessions.get('to-cancel')?.disposed()).toBe(true);
    expect((await store.load('to-cancel'))?.status.state).toBe('canceled');
  });

  it('still serves a released task by id from the task store', async () => {
    turns.set('failed', failingTurn);
    await executor.execute(requestFor('failed'), eventBus);
    expect(executor.getTask('failed')).toBeUndefined();

    const stored = await store.load('failed');
    const rebuilt = await executor.reconstruct(stored!);

    expect(rebuilt.task.taskState).toBe('failed');
    expect(rebuilt.task.getMetadata()).toMatchObject({
      id: 'failed',
      taskState: 'failed',
    });
  });

  it('does not keep a released task alive when it is asked to run again', async () => {
    turns.set('failed', failingTurn);
    await executor.execute(requestFor('failed'), eventBus);
    const stored = await store.load('failed');

    await executor.execute(
      { ...requestFor('failed'), task: stored } as unknown as RequestContext,
      eventBus,
    );

    expect(executor.getAllTasks()).toStrictEqual([]);
  });
});
