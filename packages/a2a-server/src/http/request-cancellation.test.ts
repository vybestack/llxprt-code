/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, mock } from 'bun:test';
import { once } from 'node:events';
import {
  DefaultExecutionEventBus,
  InMemoryTaskStore,
  RequestContext,
  ServerCallContext,
} from '@a2a-js/sdk/server';
import { Task } from '../agent/task.js';
void mock.module('@vybestack/llxprt-code-agents', () => ({
  createAgent: async () => {
    throw new Error('Cancellation tests supply their task session factory');
  },
}));
const { CoderAgentExecutor } = await import('../agent/executor.js');
const { createApp } = await import('./app.js');

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let complete: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: (value) => complete(value) };
}

function createHarness() {
  const entries = new Map(
    ['first', 'second'].map((id) => [
      id,
      {
        started: deferred<AbortSignal>(),
        finish: deferred<void>(),
        settled: deferred<void>(),
      },
    ]),
  );
  const store = new InMemoryTaskStore();
  const executor = new CoderAgentExecutor(
    store,
    async (taskId, contextId, _settings, eventBus) => {
      const entry = entries.get(contextId);
      if (entry === undefined)
        throw new Error(`Unexpected context ${contextId}`);
      return new Task(
        taskId,
        contextId,
        async function* (_input, options) {
          const signal = options?.signal;
          if (signal === undefined)
            throw new Error('Task omitted its turn signal');
          const aborted = deferred<void>();
          const onAbort = (): void => aborted.resolve();
          signal.addEventListener('abort', onAbort, { once: true });
          entry.started.resolve(signal);
          try {
            if (!signal.aborted)
              await Promise.race([entry.finish.promise, aborted.promise]);
            signal.throwIfAborted();
            yield { type: 'text', text: `completed ${contextId}` };
            yield { type: 'done', reason: 'stop' };
          } finally {
            signal.removeEventListener('abort', onAbort);
            entry.settled.resolve();
          }
        },
        () => {},
        () => 'fake-model',
        () => 'fake',
        () => [],
        () => [],
        () => {},
        async () => {},
        eventBus,
      );
    },
  );
  return { entries, executor, store };
}

function readEntry(
  entries: ReturnType<typeof createHarness>['entries'],
  id: string,
) {
  const entry = entries.get(id);
  if (entry === undefined) throw new Error(`Missing test entry ${id}`);
  return entry;
}

function message(contextId: string) {
  return {
    kind: 'message' as const,
    role: 'user' as const,
    messageId: `message-${contextId}`,
    contextId,
    parts: [{ kind: 'text' as const, text: contextId }],
  };
}

describe('A2A request cancellation ownership', () => {
  it('honors explicit SDK context cancellation without cancelling the concurrent task', async () => {
    const { entries, executor } = createHarness();
    const firstEntry = readEntry(entries, 'first');
    const secondEntry = readEntry(entries, 'second');
    const first = new AbortController();
    const second = new AbortController();
    const execute = (
      id: string,
      controller: AbortController,
    ): Promise<void> => {
      const user = {
        isAuthenticated: false,
        userName: '',
        requestAbortSignal: controller.signal,
      };
      return executor.execute(
        new RequestContext(
          message(id),
          id,
          id,
          undefined,
          undefined,
          new ServerCallContext(undefined, user),
        ),
        new DefaultExecutionEventBus(),
      );
    };
    const executions = [execute('first', first), execute('second', second)];
    try {
      const [firstSignal, secondSignal] = await Promise.all([
        firstEntry.started.promise,
        secondEntry.started.promise,
      ]);
      first.abort(new Error('first client disconnected'));
      expect(firstSignal.aborted).toBe(true);
      expect(secondSignal.aborted).toBe(false);
      await firstEntry.settled.promise;
      secondEntry.finish.resolve();
      await Promise.all(executions);
      expect(
        executor.getAllTasks().map((wrapper) => wrapper.task.taskState),
      ).toStrictEqual(['input-required', 'input-required']);
    } finally {
      firstEntry.finish.resolve();
      secondEntry.finish.resolve();
      await Promise.all(executions);
    }
  });

  it('cancels the disconnected HTTP stream while the sibling request completes', async () => {
    const { entries, executor, store } = createHarness();
    const firstEntry = readEntry(entries, 'first');
    const secondEntry = readEntry(entries, 'second');
    const app = await createApp({
      createStartupContext: async () => ({
        extensions: [],
        model: 'fake-model',
        git: undefined,
        checkpointing: {
          enabled: false,
          getProjectTempCheckpointsDir: () => '',
        },
        agentExecutor: executor,
        taskStoreForExecutor: store,
        taskStoreForHandler: store,
      }),
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('No TCP listener');
    const first = new AbortController();
    const second = new AbortController();
    const send = (id: string, signal: AbortSignal): Promise<Response> =>
      fetch(`http://127.0.0.1:${address.port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'message/stream',
          params: { message: message(id) },
        }),
      });
    try {
      const firstResponse = await send('first', first.signal);
      const secondResponse = await send('second', second.signal);
      const [firstSignal, secondSignal] = await Promise.all([
        firstEntry.started.promise,
        secondEntry.started.promise,
      ]);
      first.abort();
      await firstEntry.settled.promise;
      expect(firstSignal.aborted).toBe(true);
      expect(secondSignal.aborted).toBe(false);
      expect(
        executor
          .getAllTasks()
          .filter((wrapper) => wrapper.task.contextId === 'second')
          .map((wrapper) => wrapper.task.taskState),
      ).toStrictEqual(['working']);
      secondEntry.finish.resolve();
      expect(await secondResponse.text()).toContain('completed second');
      expect(secondSignal.aborted).toBe(false);
      await expect(firstResponse.text()).rejects.toThrow(/abort/i);
    } finally {
      first.abort();
      second.abort();
      firstEntry.finish.resolve();
      secondEntry.finish.resolve();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
