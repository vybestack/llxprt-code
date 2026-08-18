/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for TodoStore same-file concurrency safety (issue #3239).
 *
 * Todo tools construct a fresh TodoStore per call, so coordination must work
 * across separate store instances that target the same resolved todo file.
 * Each public operation is a whole-file read or read-modify-write
 * transaction; concurrent transactions on one file must not interleave, or a
 * list update and a pause-state update overwrite each other and can leave
 * invalid partial JSON behind. Real filesystem round-trips in temp
 * directories; no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TodoStore } from './todo-store.js';

function useTempTodoRoot(): () => string {
  let root = '';
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-store-concurrency-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return () => root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses the todo file, failing the test fast on any invalid JSON or shape so
 * partial/truncated writes surface as observable failures.
 */
function readTodoFile(filePath: string): {
  todoIds: string[];
  paused: boolean;
} {
  const raw: unknown = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!isRecord(raw) || !Array.isArray(raw.todos)) {
    throw new Error(`todo file has invalid shape: ${filePath}`);
  }
  const todoIds = raw.todos.filter(isRecord).map((todo) => String(todo['id']));
  return { todoIds, paused: raw.paused === true };
}

describe('TodoStore same-file concurrency across instances', () => {
  const rootFor = useTempTodoRoot();

  function todoFilePath(sessionId: string): string {
    return path.join(rootFor(), 'data', 'todos', `todo-${sessionId}.json`);
  }

  it('retains both todos and paused state written concurrently by separate stores', async () => {
    const dataDir = path.join(rootFor(), 'data');
    const seedingStore = new TodoStore('session-1', { dataDir });
    await seedingStore.writeTodos([
      { id: 'seed', content: 'seed todo', status: 'pending' },
    ]);

    const listWritingStore = new TodoStore('session-1', { dataDir });
    const pauseWritingStore = new TodoStore('session-1', { dataDir });

    await Promise.all([
      listWritingStore.writeTodos([
        { id: 'one', content: 'first todo', status: 'pending' },
        { id: 'two', content: 'second todo', status: 'in_progress' },
      ]),
      pauseWritingStore.writePausedState(true),
    ]);

    const file = readTodoFile(todoFilePath('session-1'));
    expect(file.paused).toBe(true);
    expect(file.todoIds).toEqual(['one', 'two']);
  });

  it('keeps request-order last-list-wins semantics for concurrent writeTodos without corruption', async () => {
    const dataDir = path.join(rootFor(), 'data');
    const seedingStore = new TodoStore('session-2', { dataDir });
    await seedingStore.writeTodos([
      { id: 'seed', content: 'seed todo', status: 'pending' },
    ]);

    const firstStore = new TodoStore('session-2', { dataDir });
    const secondStore = new TodoStore('session-2', { dataDir });
    await Promise.all([
      firstStore.writeTodos([
        { id: 'l1-a', content: 'list one item a', status: 'pending' },
        { id: 'l1-b', content: 'list one item b', status: 'pending' },
      ]),
      secondStore.writeTodos([
        { id: 'l2-a', content: 'list two item a', status: 'in_progress' },
        { id: 'l2-b', content: 'list two item b', status: 'pending' },
        { id: 'l2-c', content: 'list two item c', status: 'completed' },
      ]),
    ]);

    const file = readTodoFile(todoFilePath('session-2'));
    expect(file.todoIds).toEqual(['l2-a', 'l2-b', 'l2-c']);
    expect(file.paused).toBe(false);
  });

  it('lets later same-path operations succeed after an earlier operation fails', async () => {
    const dataDir = path.join(rootFor(), 'data');
    const seedingStore = new TodoStore('session-3', { dataDir });
    await seedingStore.writeTodos([
      { id: 'seed', content: 'seed todo', status: 'pending' },
    ]);

    const failingStore = new TodoStore('session-3', { dataDir });
    const pausingStore = new TodoStore('session-3', { dataDir });
    const results = await Promise.allSettled([
      failingStore.writeTodos([
        // Empty content fails todo validation mid-transaction, after the
        // read-existing step, so the failure happens inside the operation.
        { id: 'bad', content: '', status: 'pending' },
      ]),
      pausingStore.writePausedState(true),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');

    const followUpStore = new TodoStore('session-3', { dataDir });
    await followUpStore.writeTodos([
      { id: 'after-failure', content: 'later todo', status: 'pending' },
    ]);

    const file = readTodoFile(todoFilePath('session-3'));
    expect(file.todoIds).toEqual(['after-failure']);
    expect(file.paused).toBe(true);
  });
});
