/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider-to-canonical-observation-seam integration tests for issue #3052.
 *
 * A provider-originated mutation through `updateTodos` must reach the
 * `todoEvents` observation channel exactly once, so external observers
 * (JSP/jefe, Zed) stop retaining a stale list, while the originating
 * provider's own `todoEvents` listener does not re-enter on its own echo
 * (the origin suppresses it). External TodoWrite events remain authoritative.
 *
 * The wiring under test is real — no mocks on the observation seam:
 *   - The real `TodoProvider` is rendered and its real context value captured.
 *   - The real `createTodoObservationSubscription` (the exact seam
 *     `JspProducer` subscribes through in jspWiring) is subscribed, so a
 *     passing assertion proves the observation channel is actually reached.
 *   - The real `todoCommand` subcommands are driven with a `CommandContext`
 *     whose `todoContext` is the LIVE provider context.
 *
 * The provider, React, the event emitter, and the observation seam stay real.
 * Storage is isolated to a per-process temp dir by the manifest preloads, so
 * the real `TodoStore` disk I/O is sandboxed; each test uses a unique sessionId
 * so its store file never collides with another test's. A peer provider is
 * mounted in its own React root to assert that a provider-originated
 * publication still reaches a matching peer while the origin suppresses its own
 * echo. The mount/session read does not publish and is out of scope here.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import React, { act } from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TodoStore,
  todoEvents,
  TodoEvent,
  DEFAULT_AGENT_ID,
  type Todo,
  type TodoUpdateEvent,
} from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import { renderHook, waitFor } from '../../../test-utils/render.js';
import { TodoProvider } from '../TodoProvider.js';
import { useTodoContext } from '../TodoContext.js';
import { createTodoObservationSubscription } from '../../../observation/jspWiring.js';
import { todoCommand } from '../../commands/todoCommand.js';
import { shouldClearTodos } from '../../hooks/useTodoPausePreserver.js';
import type { CommandContext } from '../../commands/types.js';

interface ObservedEvent {
  agentId: string | undefined;
  todos: readonly Todo[];
}

type TodoContextValue = ReturnType<typeof useTodoContext>;

interface MountedProvider {
  readonly result: {
    readonly current: TodoContextValue;
    readonly all: readonly TodoContextValue[];
  };
  readonly rerender: () => void;
  readonly unmount: () => void;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  const errors: unknown[] = [];
  while (cleanups.length > 0) {
    try {
      cleanups.pop()?.();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'TodoProvider test cleanup failed');
  }
});

function todosDir(): string {
  return path.join(Storage.getGlobalDataDir(), 'todos');
}

/**
 * Read a session's task file directly from disk, bypassing any active
 * provider so persistence assertions are not perturbed.
 */
function readDiskTodos(sessionId: string, agentId?: string): Todo[] {
  const scoped = agentId && agentId !== DEFAULT_AGENT_ID ? agentId : undefined;
  const fileName = scoped
    ? `todo-${sessionId}-${scoped}.json`
    : `todo-${sessionId}.json`;
  const filePath = path.join(todosDir(), fileName);
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as
    | { todos?: Todo[] }
    | Todo[];
  return Array.isArray(raw) ? raw : (raw.todos ?? []);
}

function storeFor(sessionId: string, agentId?: string): TodoStore {
  return new TodoStore(
    sessionId,
    { dataDirResolver: () => Storage.getGlobalDataDir() },
    agentId,
  );
}

/**
 * Narrow an outer-write capture from its nullable holder. Kept as a helper so
 * the null guard does not appear directly inside a test body.
 */
function unwrapOuterCapture(
  capture: {
    store: TodoStore;
    todos: Todo[];
  } | null,
): { store: TodoStore; todos: Todo[] } {
  if (capture === null) {
    throw new Error('outer TodoStore write was not captured');
  }
  return capture;
}

/**
 * Drive the provider's refresh and settle its async read. `refreshTodos`
 * returns a real promise at runtime, but the context type declares `void`, so
 * it is wrapped to settle the read without an await-thenable violation.
 */
async function settleRefresh(refresh: () => void): Promise<void> {
  await Promise.resolve(refresh());
}

/**
 * Subscribe to the REAL observation seam and collect every published event.
 */
function observeTodoChannel(): ObservedEvent[] {
  const events: ObservedEvent[] = [];
  const unsubscribe = createTodoObservationSubscription((agentId, todos) => {
    events.push({ agentId, todos });
  });
  cleanups.push(unsubscribe);
  return events;
}

function mountProvider(sessionId: string, agentId?: string): MountedProvider {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <TodoProvider sessionId={sessionId} agentId={agentId}>
      {children}
    </TodoProvider>
  );
  const rendered = renderHook(() => useTodoContext(), { wrapper: Wrapper });
  cleanups.push(rendered.unmount);
  return rendered;
}

/**
 * Build a `CommandContext` whose `todoContext` is the LIVE provider context,
 * so task subcommands read and mutate the real provider state. The remaining
 * fields are inert stubs; only `ui.addItem` is observable, to surface errors.
 */
function commandContextFrom(
  live: TodoContextValue,
  errors: string[],
): CommandContext {
  return {
    signal: new AbortController().signal,
    services: {
      config: null,
      agent: null,
      settings: {} as unknown as CommandContext['services']['settings'],
      git: undefined,
      logger: {
        error: (m: string) => errors.push(m),
      } as unknown as CommandContext['services']['logger'],
    },
    ui: {
      addItem: ((item: { type?: string; text?: string }) => {
        if (item.type === 'error') errors.push(item.text ?? 'error');
      }) as unknown as CommandContext['ui']['addItem'],
      clear: () => {},
      setDebugMessage: () => {},
      pendingItem: null,
      setPendingItem: () => {},
      loadHistory: () => {},
      toggleCorgiMode: () => {},
      toggleDebugProfiler: () => {},
      toggleVimEnabled: () => Promise.resolve(true),
      setLlxprtMdFileCount: () => {},
      updateHistoryTokenCount: () => {},
      reloadCommands: () => {},
      extensionsUpdateState:
        new Map() as CommandContext['ui']['extensionsUpdateState'],
      dispatchExtensionStateUpdate: () => {},
      addConfirmUpdateExtensionRequest: () => {},
    },
    session: {
      stats: {} as CommandContext['session']['stats'],
      sessionShellAllowlist: new Set<string>(),
    },
    todoContext: {
      todos: live.todos,
      updateTodos: live.updateTodos,
      // Production (useAppInput.ts) passes a no-op refreshTodos to the command
      // context; no list subcommand invokes it.
      refreshTodos: () => {},
    },
  };
}

async function runSubcommand(
  live: TodoContextValue,
  name: string,
  args: string,
): Promise<string[]> {
  const sub = todoCommand.subCommands?.find((c) => c.name === name);
  const action = sub?.action;
  if (!action) throw new Error(`task subcommand "${name}" has no action`);
  const errors: string[] = [];
  await act(async () => {
    // The action may be sync (most task operations) or async; normalize so a
    // sync return is awaited without an await-thenable lint violation.
    await Promise.resolve(action(commandContextFrom(live, errors), args));
  });
  return errors;
}

/**
 * Seed the session's store on disk, mount the provider, and settle its
 * initial read so the provider is at the seed before assertions run.
 */
async function seedDiskAndMount(
  sessionId: string,
  seed: Todo[],
  agentId?: string,
): Promise<MountedProvider> {
  await storeFor(sessionId, agentId).writeTodos(seed);
  const mounted = mountProvider(sessionId, agentId);
  await act(async () => {
    await settleRefresh(mounted.result.current.refreshTodos);
  });
  expect(mounted.result.current.todos).toEqual(seed);
  return mounted;
}

/** Seed, observe, and run one subcommand; return the observed events. */
async function seedObserveRun(
  sessionId: string,
  seed: Todo[],
  name: string,
  args: string,
): Promise<ObservedEvent[]> {
  const mounted = await seedDiskAndMount(sessionId, seed);
  const events = observeTodoChannel();
  const errors = await runSubcommand(mounted.result.current, name, args);
  expect(errors).toEqual([]);
  return events;
}

function todo(
  id: string,
  content: string,
  status: Todo['status'] = 'pending',
  subtasks?: NonNullable<Todo['subtasks']>,
): Todo {
  return subtasks ? { id, content, status, subtasks } : { id, content, status };
}

describe('TodoProvider observation (issue #3052)', () => {
  describe('/todo clear on a non-empty list', () => {
    it('publishes an empty replacement, clears provider state, and clears disk', async () => {
      const sessionId = 'obs-clear';
      const mounted = await seedDiskAndMount(sessionId, [
        todo('c1', 'Write plan'),
        todo('c2', 'Ship fix'),
      ]);
      expect(mounted.result.current.todos).toHaveLength(2);
      const events = observeTodoChannel();

      const errors = await runSubcommand(mounted.result.current, 'clear', '');
      expect(errors).toEqual([]);

      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([]);
      expect(mounted.result.current.todos).toEqual([]);
      await waitFor(() => {
        expect(readDiskTodos(sessionId)).toEqual([]);
      });
    });
  });

  describe('every mutation subcommand publishes to the observer', () => {
    it('/todo set marks the task in_progress and publishes', async () => {
      const events = await seedObserveRun(
        'obs-set',
        [todo('s1', 'Task one')],
        'set',
        '1',
      );
      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([
        { id: 's1', content: 'Task one', status: 'in_progress' },
      ]);
    });

    it('/todo unset returns the task to pending and publishes', async () => {
      const events = await seedObserveRun(
        'obs-unset',
        [todo('u1', 'Task one', 'in_progress')],
        'unset',
        '1',
      );
      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([
        { id: 'u1', content: 'Task one', status: 'pending' },
      ]);
    });

    it('/todo add inserts a task and publishes the grown list', async () => {
      const events = await seedObserveRun(
        'obs-add',
        [todo('a1', 'First')],
        'add',
        '2 Second',
      );
      expect(events).toHaveLength(1);
      expect(events[0].todos).toHaveLength(2);
      expect(events[0].todos[1].content).toBe('Second');
    });

    it('/todo add 1.2 inserts a subtask and publishes', async () => {
      const events = await seedObserveRun(
        'obs-add-subtask',
        [
          todo('p1', 'Parent', 'pending', [
            { id: 'p1.1', content: 'First sub' },
          ]),
        ],
        'add',
        '1.2 Second sub',
      );
      expect(events).toHaveLength(1);
      const published = events[0].todos[0];
      expect(published.subtasks?.length).toBe(2);
      expect(published.subtasks?.[1]?.content).toBe('Second sub');
    });

    it('/todo remove <n> drops the task and publishes', async () => {
      const events = await seedObserveRun(
        'obs-remove-n',
        [todo('r1', 'Keep'), todo('r2', 'Drop')],
        'remove',
        '2',
      );
      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([todo('r1', 'Keep')]);
    });

    it('/todo remove 1.2 drops the subtask and publishes', async () => {
      const events = await seedObserveRun(
        'obs-remove-subtask',
        [
          todo('p1', 'Parent', 'pending', [
            { id: 'p1.1', content: 'Keep' },
            { id: 'p1.2', content: 'Drop' },
          ]),
        ],
        'remove',
        '1.2',
      );
      expect(events).toHaveLength(1);
      const published = events[0].todos[0];
      expect(published.subtasks?.length).toBe(1);
      expect(published.subtasks?.[0]?.content).toBe('Keep');
    });

    it('/todo remove all empties the list and publishes an empty replacement', async () => {
      const events = await seedObserveRun(
        'obs-remove-all',
        [todo('ra1', 'One'), todo('ra2', 'Two')],
        'remove',
        'all',
      );
      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([]);
    });

    it('/todo remove 2-4 drops the range and publishes', async () => {
      const events = await seedObserveRun(
        'obs-remove-range',
        [
          todo('rr1', 'One'),
          todo('rr2', 'Two'),
          todo('rr3', 'Three'),
          todo('rr4', 'Four'),
          todo('rr5', 'Five'),
        ],
        'remove',
        '2-4',
      );
      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([
        todo('rr1', 'One'),
        todo('rr5', 'Five'),
      ]);
    });

    it('/todo undo resets status to pending and publishes', async () => {
      const events = await seedObserveRun(
        'obs-undo',
        [todo('z1', 'In flight', 'in_progress')],
        'undo',
        '1',
      );
      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([
        { id: 'z1', content: 'In flight', status: 'pending' },
      ]);
    });

    it('/todo undo 2-4 resets the range to pending and publishes', async () => {
      const events = await seedObserveRun(
        'obs-undo-range',
        [
          todo('ur1', 'One'),
          todo('ur2', 'Two', 'in_progress'),
          todo('ur3', 'Three', 'completed'),
          todo('ur4', 'Four', 'in_progress'),
          todo('ur5', 'Five'),
        ],
        'undo',
        '2-4',
      );
      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([
        todo('ur1', 'One'),
        todo('ur2', 'Two'),
        todo('ur3', 'Three'),
        todo('ur4', 'Four'),
        todo('ur5', 'Five'),
      ]);
    });

    it('/todo undo all resets every task to pending and publishes', async () => {
      const events = await seedObserveRun(
        'obs-undo-all',
        [todo('ua1', 'One', 'in_progress'), todo('ua2', 'Two', 'completed')],
        'undo',
        'all',
      );
      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([todo('ua1', 'One'), todo('ua2', 'Two')]);
    });

    it('/todo load publishes the loaded session', async () => {
      const sessionId = 'obs-load';
      // Write a saved session file distinct from the active session file and
      // pin its mtime to the future so getTodoSessionFiles lists it first
      // (i.e. `load 1` resolves to it) regardless of other tests' files.
      fs.mkdirSync(todosDir(), { recursive: true });
      const archivePath = path.join(todosDir(), 'todo-obs-load-archive.json');
      const archived: Todo[] = [todo('L1', 'Loaded task')];
      fs.writeFileSync(
        archivePath,
        JSON.stringify({ todos: archived, paused: false }),
      );
      const future = new Date('2099-01-01T00:00:00Z');
      fs.utimesSync(archivePath, future, future);
      cleanups.push(() => fs.rmSync(archivePath, { force: true }));
      const mounted = await seedDiskAndMount(sessionId, [
        todo('pre', 'Before load'),
      ]);
      const events = observeTodoChannel();
      const errors = await runSubcommand(mounted.result.current, 'load', '1');
      expect(errors).toEqual([]);

      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual(archived);
      expect(mounted.result.current.todos).toEqual(archived);
    });
  });

  // The JSP observation seam (createTodoObservationSubscription) intentionally
  // strips sessionId, so these assert agent/todos only. Session-id identity is
  // asserted directly against the canonical event later.
  describe('published payload carries provider agent scoping (JSP seam)', () => {
    it('publishes the explicit agentId prop on the event', async () => {
      const agentId = 'agent-7';
      const mounted = await seedDiskAndMount(
        'obs-scope-explicit',
        [todo('e1', 'Scoped')],
        agentId,
      );
      const events = observeTodoChannel();
      await runSubcommand(mounted.result.current, 'clear', '');
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBe(agentId);
    });

    it('publishes undefined agentId under the default (no agentId prop)', async () => {
      const mounted = await seedDiskAndMount('obs-scope-default', [
        todo('d1', 'Default'),
      ]);
      const events = observeTodoChannel();
      await runSubcommand(mounted.result.current, 'clear', '');
      expect(events).toHaveLength(1);
      expect(events[0].agentId).toBeUndefined();
    });
  });

  describe('a single mutation applies once and publishes once', () => {
    it('applies /todo add exactly once to provider state and emits one publication', async () => {
      const sessionId = 'obs-once';
      const mounted = await seedDiskAndMount(sessionId, [todo('o1', 'Seed')]);
      const events = observeTodoChannel();
      const rendersBefore = mounted.result.all.length;

      await runSubcommand(mounted.result.current, 'add', '2 Added');

      // updateTodos applies local state exactly once (one committed render)
      // and publishes exactly once. The origin's own echo is suppressed by the
      // per-provider flag, so no second setTodos fires.
      expect(mounted.result.all.length).toBe(rendersBefore + 1);
      expect(events).toHaveLength(1);
      expect(events[0].todos).toHaveLength(2);
    });
  });

  describe('external todoEvents emits still reach the provider (regression)', () => {
    it('applies a TodoWrite-shaped emit for the same session/agent', async () => {
      const sessionId = 'obs-ext-same';
      const agentId = 'agent-9';
      const mounted = await seedDiskAndMount(
        sessionId,
        [todo('x1', 'Original')],
        agentId,
      );
      const external: Todo[] = [todo('x2', 'From tool', 'in_progress')];
      act(() => {
        todoEvents.emitTodoUpdated({
          sessionId,
          agentId,
          todos: external,
          timestamp: new Date(),
        });
      });
      expect(mounted.result.current.todos).toEqual(external);
    });

    it('ignores an emit for a different session', async () => {
      const sessionId = 'obs-ext-diff';
      const mounted = await seedDiskAndMount(sessionId, [
        todo('k1', 'Keep me'),
      ]);
      const before = mounted.result.current.todos;
      act(() => {
        todoEvents.emitTodoUpdated({
          sessionId: 'some-other-session',
          agentId: undefined,
          todos: [todo('intruder', 'Should not apply')],
          timestamp: new Date(),
        });
      });
      expect(mounted.result.current.todos).toEqual(before);
    });

    it('ignores an emit for a different agent in the same session', async () => {
      const sessionId = 'obs-ext-diff-agent';
      const agentId = 'agent-owner';
      const mounted = await seedDiskAndMount(
        sessionId,
        [todo('m1', 'Owner task')],
        agentId,
      );
      const before = mounted.result.current.todos;
      act(() => {
        todoEvents.emitTodoUpdated({
          sessionId,
          agentId: 'agent-intruder',
          todos: [todo('spy', 'Other agent')],
          timestamp: new Date(),
        });
      });
      expect(mounted.result.current.todos).toEqual(before);
    });
  });

  describe('shouldClearTodos + provider updateTodos choke point (auto-clear)', () => {
    it('publishes an empty replacement when shouldClearTodos triggers updateTodos([])', async () => {
      const sessionId = 'obs-autoclear';
      const mounted = await seedDiskAndMount(sessionId, [
        todo('ac1', 'Done one', 'completed'),
        todo('ac2', 'Done two', 'completed'),
      ]);
      const events = observeTodoChannel();

      expect(shouldClearTodos(mounted.result.current.todos)).toBe(true);
      act(() => {
        mounted.result.current.updateTodos([]);
      });

      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual([]);
      expect(mounted.result.current.todos).toEqual([]);
    });
  });

  // The JSP seam strips sessionId, so session-scoping is asserted directly
  // against the canonical todoEvents payload here.
  describe('raw canonical event carries provider session/agent identity', () => {
    it('carries the explicit sessionId and agentId', async () => {
      const sessionId = 'obs-raw-explicit';
      const agentId = 'agent-raw';
      const mounted = await seedDiskAndMount(
        sessionId,
        [todo('r1', 'Seed')],
        agentId,
      );

      const rawEvents: TodoUpdateEvent[] = [];
      const listener = (event: TodoUpdateEvent): void => {
        rawEvents.push(event);
      };
      todoEvents.onTodoUpdated(listener);
      cleanups.push(() => todoEvents.offTodoUpdated(listener));

      act(() => {
        mounted.result.current.updateTodos([todo('r2', 'New')]);
      });

      expect(rawEvents.length).toBeGreaterThanOrEqual(1);
      const last = rawEvents[rawEvents.length - 1];
      expect(last.sessionId).toBe(sessionId);
      expect(last.agentId).toBe(agentId);
    });

    it('carries the sessionId with undefined agentId under the default', async () => {
      const sessionId = 'obs-raw-default';
      const mounted = await seedDiskAndMount(sessionId, [todo('d1', 'Seed')]);

      const rawEvents: TodoUpdateEvent[] = [];
      const listener = (event: TodoUpdateEvent): void => {
        rawEvents.push(event);
      };
      todoEvents.onTodoUpdated(listener);
      cleanups.push(() => todoEvents.offTodoUpdated(listener));

      act(() => {
        mounted.result.current.updateTodos([todo('d2', 'New')]);
      });

      const last = rawEvents[rawEvents.length - 1];
      expect(last.sessionId).toBe(sessionId);
      expect(last.agentId).toBeUndefined();
    });
  });

  // The origin suppresses only its own exact synchronous event object. Because
  // the echo carries the same array reference as the local state updateTodos
  // just applied, suppression is not independently observable through a render
  // count; these tests instead pin peer delivery and prove that later or
  // synchronously nested external event objects remain authoritative.
  describe('origin echo suppression (issue #3052)', () => {
    it('delivers a provider-originated publication to a matching peer provider', async () => {
      const sessionId = 'peer-deliver';
      const agentId = 'agent-peer';
      const seed = [todo('p-seed', 'Seed')];
      await storeFor(sessionId, agentId).writeTodos(seed);

      // Two independent provider instances share the same session/agent scope
      // and the singleton todoEvents channel.
      const origin = mountProvider(sessionId, agentId);
      const peer = mountProvider(sessionId, agentId);
      await act(async () => {
        await settleRefresh(origin.result.current.refreshTodos);
        await settleRefresh(peer.result.current.refreshTodos);
      });
      expect(origin.result.current.todos).toEqual(seed);
      expect(peer.result.current.todos).toEqual(seed);

      const events = observeTodoChannel();
      const published: Todo[] = [todo('p1', 'From origin', 'in_progress')];
      act(() => {
        origin.result.current.updateTodos(published);
      });

      // The origin skips its exact publication object; the peer's listener still
      // applies the replacement exactly once, and the observer receives exactly
      // one publication.
      expect(origin.result.current.todos).toEqual(published);
      expect(peer.result.current.todos).toEqual(published);
      expect(events).toHaveLength(1);
      expect(events[0].todos).toEqual(published);
    });

    it('a provider-originated publication does not suppress a later external event', async () => {
      const sessionId = 'echo-s';
      const agentId = 'agent-echo';
      const mounted = await seedDiskAndMount(
        sessionId,
        [todo('e-seed', 'Seed')],
        agentId,
      );

      act(() => {
        mounted.result.current.updateTodos([todo('e1', 'Origin update')]);
      });

      const external: Todo[] = [todo('e2', 'External', 'completed')];
      act(() => {
        todoEvents.emitTodoUpdated({
          sessionId,
          agentId,
          todos: external,
          timestamp: new Date(),
        });
      });
      expect(mounted.result.current.todos).toEqual(external);
    });

    it('does not mistake a synchronously nested external event for the origin publication', async () => {
      const sessionId = 'echo-nested';
      const agentId = 'agent-nested';
      const mounted = await seedDiskAndMount(
        sessionId,
        [todo('n-seed', 'Seed')],
        agentId,
      );
      const nested: Todo[] = [todo('n-external', 'Nested external')];
      let nestedPublished = false;
      const publishNested = (): void => {
        if (nestedPublished) return;
        nestedPublished = true;
        todoEvents.emitTodoUpdated({
          sessionId,
          agentId,
          todos: nested,
          timestamp: new Date(),
        });
      };
      todoEvents.prependListener(TodoEvent.TODO_UPDATED, publishNested);
      cleanups.push(() =>
        todoEvents.removeListener(TodoEvent.TODO_UPDATED, publishNested),
      );

      act(() => {
        mounted.result.current.updateTodos([todo('n-origin', 'Origin')]);
      });

      expect(mounted.result.current.todos).toEqual(nested);
    });

    it('preserves a synchronously nested provider update as the final list', async () => {
      const sessionId = 'echo-nested-provider';
      const agentId = 'agent-nested-provider';
      const mounted = await seedDiskAndMount(
        sessionId,
        [todo('np-seed', 'Seed')],
        agentId,
      );

      // Spy ONLY on the TodoStore write boundary so the outer write can be held,
      // making persistence ordering deterministic rather than dependent on the
      // filesystem scheduler. The provider, React, the event emitter, and the
      // observation seam stay real; only the storage write is intercepted, and
      // the real captured write is invoked on release (no mock theater).
      const realWriteTodos = TodoStore.prototype.writeTodos;
      let outerCapture: { store: TodoStore; todos: Todo[] } | null = null;
      let writeTodosCalls = 0;
      let releaseOuterWrite: () => void = () => {};
      const outerWriteHeld = new Promise<void>((resolve) => {
        releaseOuterWrite = resolve;
      });
      TodoStore.prototype.writeTodos = function (
        this: TodoStore,
        todos: Todo[],
      ): Promise<void> {
        writeTodosCalls++;
        if (outerCapture === null) {
          outerCapture = { store: this, todos };
          return outerWriteHeld;
        }
        return realWriteTodos.call(this, todos);
      };
      cleanups.push(() => {
        TodoStore.prototype.writeTodos = realWriteTodos;
      });

      const nested: Todo[] = [todo('np-nested', 'Nested provider update')];
      let nestedPublished = false;
      const publishNested = (): void => {
        if (nestedPublished) return;
        nestedPublished = true;
        mounted.result.current.updateTodos(nested);
      };
      todoEvents.prependListener(TodoEvent.TODO_UPDATED, publishNested);
      cleanups.push(() =>
        todoEvents.removeListener(TodoEvent.TODO_UPDATED, publishNested),
      );

      act(() => {
        mounted.result.current.updateTodos([todo('np-origin', 'Origin')]);
      });

      expect(mounted.result.current.todos).toEqual(nested);

      // The nested write is chained behind the held outer write, so it has not
      // started: only the outer write was invoked, and disk still carries the
      // seed. This proves the nested write is queued, not racing.
      expect(writeTodosCalls).toBe(1);
      expect(readDiskTodos(sessionId, agentId)).toEqual([
        todo('np-seed', 'Seed'),
      ]);

      // Release: invoke the real captured outer write (persisting Origin), then
      // unblock the chain so the queued nested write runs and wins on disk.
      const capture = unwrapOuterCapture(outerCapture);
      await realWriteTodos.call(capture.store, capture.todos);
      expect(readDiskTodos(sessionId, agentId)).toEqual([
        todo('np-origin', 'Origin'),
      ]);
      releaseOuterWrite();
      await waitFor(() => {
        expect(readDiskTodos(sessionId, agentId)).toEqual(nested);
      });
    });
  });
});
