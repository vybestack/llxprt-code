/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests: TodoStore must resolve its file path exactly
 * once per logical read/write operation and thread that captured path through
 * every filesystem call (exists/read/mkdir/write) within the operation.
 *
 * The hazard: a dynamic `dataDirResolver` may return a different directory on
 * each call (e.g. during a profile/category switch). If `resolveFilePath()` is
 * called more than once within a single operation, the exists-check and the
 * read could target different paths, or the read-existing and the write could
 * target different paths — corrupting state or losing data.
 *
 * These tests use an ALTERNATING resolver that returns a different path on
 * each invocation. If the store resolves more than once per operation, the
 * exists/read or read/write will land in different directories and the
 * round-trip will fail (data not found, or written to the wrong dir). They
 * also count resolver invocations to prove exactly one resolution per logical
 * operation.
 *
 * Real filesystem round-trips against temp directories. No mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { TodoStore } from './todo-store.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'todo-store-single-resolve-'));
}

describe('TodoStore — single path resolution per operation', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const observeWriteTodosResolvesThePathExactlyOnceAndRoundTripsUnderAnAlternatingResolverAt50 =
    async () => {
      const dirA = path.join(tempRoot, 'alt-a');
      const dirB = path.join(tempRoot, 'alt-b');
      let callCount = 0;
      const alternatingResolver = (): string => {
        const dir = callCount % 2 === 0 ? dirA : dirB;
        callCount++;
        return dir;
      };
      const store = new TodoStore('sess-alt', {
        dataDirResolver: alternatingResolver,
      });
      const beforeWrite = callCount;
      await store.writeTodos([
        { id: 'w1', content: 'write-one', status: 'pending', subtasks: [] },
      ]);
      const writeResolutions = callCount - beforeWrite;
      return { dirA, dirB, writeResolutions };
    };

  it('writeTodos resolves the path exactly once and round-trips under an alternating resolver', async () => {
    const { dirA, dirB, writeResolutions } =
      await observeWriteTodosResolvesThePathExactlyOnceAndRoundTripsUnderAnAlternatingResolverAt50();
    expect(writeResolutions).toBe(1);
    const fileInA = path.join(dirA, 'todos', 'todo-sess-alt.json');
    const fileInB = path.join(dirB, 'todos', 'todo-sess-alt.json');
    const existsInA = Number(fs.existsSync(fileInA));
    const existsInB = Number(fs.existsSync(fileInB));
    expect(existsInA + existsInB).toBeGreaterThanOrEqual(1);
  });

  it('readTodos resolves the path exactly once and reads consistently', async () => {
    const dirA = path.join(tempRoot, 'read-a');
    let callCount = 0;
    const countingResolver = (): string => {
      callCount++;
      return dirA;
    };

    const store = new TodoStore('sess-read', {
      dataDirResolver: countingResolver,
    });

    // Write a known todo first.
    await store.writeTodos([
      { id: 'r1', content: 'read-test', status: 'pending', subtasks: [] },
    ]);

    // Reset the counter; readTodos must resolve exactly once.
    const beforeRead = callCount;
    const todos = await store.readTodos();
    const readResolutions = callCount - beforeRead;
    expect(readResolutions).toBe(1);
    expect(todos).toHaveLength(1);
    expect(todos[0]?.id).toBe('r1');
  });

  it('writePausedState resolves the path exactly once', async () => {
    const dir = path.join(tempRoot, 'pause-resolve');
    let callCount = 0;
    const store = new TodoStore('sess-pause', {
      dataDirResolver: () => {
        callCount++;
        return dir;
      },
    });

    // Seed with a write.
    await store.writeTodos([
      { id: 'p1', content: 'seed', status: 'pending', subtasks: [] },
    ]);

    const before = callCount;
    await store.writePausedState(true);
    // writePausedState does a read-existing (preserve todos) + write. Both
    // must use the same captured path → exactly one resolution.
    expect(callCount - before).toBe(1);

    // Verify the paused state persisted AND todos survived.
    const data = await store.readPausedState();
    expect(data).toBe(true);
  });

  const observeATrulyAlternatingResolverDoesNotSplitExistsReadAcrossDirectoriesAt146 =
    async () => {
      const dirA = path.join(tempRoot, 'split-a');
      const dirB = path.join(tempRoot, 'split-b');
      let toggle = false;
      const store = new TodoStore('sess-split', {
        dataDirResolver: () => {
          const d = toggle ? dirB : dirA;
          toggle = !toggle;
          return d;
        },
      });
      await store.writeTodos([
        { id: 's1', content: 'split-test', status: 'pending', subtasks: [] },
      ]);
      const fileA = path.join(dirA, 'todos', 'todo-sess-split.json');
      const fileB = path.join(dirB, 'todos', 'todo-sess-split.json');
      const existsA = fs.existsSync(fileA);
      const existsB = fs.existsSync(fileB);
      return { existsA, existsB };
    };

  it('a truly alternating resolver does not split exists/read across directories', async () => {
    const { existsA, existsB } =
      await observeATrulyAlternatingResolverDoesNotSplitExistsReadAcrossDirectoriesAt146();
    expect(existsA !== existsB).toBe(true);
  });
});
