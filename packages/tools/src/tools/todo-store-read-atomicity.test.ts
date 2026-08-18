/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for TodoStore read atomicity and cross-path parallelism
 * (issue #3239).
 *
 * A concurrent read must observe a complete before-or-after state, never a
 * truncated or partially written file. To expose the write window
 * deterministically, the fs.promises.writeFile used by TodoStore is wrapped
 * so it opens/truncates the target, reports the truncation, and only performs
 * the actual data write once the test releases it. All other filesystem
 * behavior is the real implementation. This is infrastructure control only —
 * the store under test is the real TodoStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const actualFs = { ...(await import('fs')) };
const actualPromises = { ...(await import('fs/promises')) };

interface WriteGatePlan {
  /** When 'hold', writes truncate, report, and wait for the release signal. */
  mode: 'off' | 'hold';
  onTruncate?: (filePath: string) => void;
  releaseSignal?: Promise<void>;
}

let writePlan: WriteGatePlan = { mode: 'off' };

void vi.mock('fs', () => ({
  ...actualFs,
  promises: {
    ...actualFs.promises,
    writeFile: async (
      filePath: string,
      data: string,
      encoding: BufferEncoding,
    ): Promise<void> => {
      if (writePlan.mode !== 'hold') {
        await actualPromises.writeFile(filePath, data, encoding);
        return;
      }
      const handle = await actualPromises.open(filePath, 'w');
      try {
        writePlan.onTruncate?.(filePath);
        await writePlan.releaseSignal;
        await handle.writeFile(data, encoding);
      } finally {
        await handle.close();
      }
    },
  },
}));

const { TodoStore } = await import('./todo-store.js');

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = () => {
    throw new Error('deferred settle called before initialization');
  };
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value) => settle(value) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function todoIdsOf(raw: unknown): string[] {
  if (!isRecord(raw) || !Array.isArray(raw.todos)) {
    return ['invalid-todo-file'];
  }
  return raw.todos.filter(isRecord).map((todo) => String(todo['id']));
}

describe('TodoStore read atomicity and cross-path parallelism', () => {
  let root = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-store-atomicity-'));
    writePlan = { mode: 'off' };
  });

  afterEach(() => {
    writePlan = { mode: 'off' };
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('never lets a concurrent read observe a truncated todo file', async () => {
    const dataDir = path.join(root, 'data');
    const seedingStore = new TodoStore('session-atomic', { dataDir });
    await seedingStore.writeTodos([
      { id: 'seed', content: 'seed todo', status: 'pending' },
    ]);

    const truncated = deferred<void>();
    const release = deferred<void>();
    writePlan = {
      mode: 'hold',
      onTruncate: () => truncated.resolve(),
      releaseSignal: release.promise,
    };

    const writer = new TodoStore('session-atomic', { dataDir }).writeTodos([
      { id: 'fresh', content: 'fresh todo', status: 'pending' },
    ]);
    await truncated.promise;

    const reader = new TodoStore('session-atomic', { dataDir }).readTodos();
    release.resolve();

    let observedIds: string[] | undefined;
    let readError: Error | undefined;
    try {
      observedIds = (await reader).map((todo) => String(todo.id));
    } catch (error) {
      readError = error instanceof Error ? error : new Error(String(error));
    }
    await writer;

    expect(readError).toBeUndefined();
    const observedCompleteState =
      observedIds?.join(',') === 'seed' || observedIds?.join(',') === 'fresh';
    expect(observedCompleteState).toBe(true);
  });

  it('runs operations for different todo files in parallel', async () => {
    const dataDir = path.join(root, 'data');
    const release = deferred<void>();
    const truncatedPaths = new Set<string>();
    const expectedFiles = [
      path.join(dataDir, 'todos', 'todo-session-a.json'),
      path.join(dataDir, 'todos', 'todo-session-b.json'),
    ];
    writePlan = {
      mode: 'hold',
      onTruncate: (filePath) => {
        truncatedPaths.add(filePath);
        if (expectedFiles.every((expected) => truncatedPaths.has(expected))) {
          release.resolve();
        }
      },
      releaseSignal: release.promise,
    };

    // Both writes must reach their truncation point before either may
    // proceed. If same-path coordination wrongly serialized different files,
    // the first write would wait forever for the second truncation.
    await Promise.all([
      new TodoStore('session-a', { dataDir }).writeTodos([
        { id: 'a1', content: 'session a todo', status: 'pending' },
      ]),
      new TodoStore('session-b', { dataDir }).writeTodos([
        { id: 'b1', content: 'session b todo', status: 'pending' },
      ]),
    ]);

    const fileA: unknown = JSON.parse(
      fs.readFileSync(expectedFiles[0], 'utf-8'),
    );
    const fileB: unknown = JSON.parse(
      fs.readFileSync(expectedFiles[1], 'utf-8'),
    );
    expect(todoIdsOf(fileA)).toEqual(['a1']);
    expect(todoIdsOf(fileB)).toEqual(['b1']);
  });
});
