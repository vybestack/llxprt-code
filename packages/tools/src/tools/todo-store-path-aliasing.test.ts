/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test for TodoStore queue keying across alias-spelled data
 * directories (issue #3239).
 *
 * The process-local transaction queues must be keyed by the platform-native
 * lexically normalized once-resolved todo file path: two stores whose
 * dataDir spellings differ lexically (data vs data/../data) but denote the
 * same actual directory must serialize on one queue, or their complementary
 * read-modify-write transactions overwrite each other's fields. To expose
 * the pre-normalization race deterministically, fs.promises.readFile is
 * held for a fixed number of macrotask turns, so two concurrently running
 * transactions both read the pre-write snapshot before either write lands.
 * All other filesystem behavior is the real implementation; the store under
 * test is the real TodoStore. Normalization is lexical only (path.normalize):
 * symlink and hardlink aliasing stay outside the coordination contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const actualFs = { ...(await import('fs')) };
const actualPromises = { ...(await import('fs/promises')) };

const READ_HOLD_MACROTASKS = 10;

let holdReads = false;

async function holdForMacrotaskTurns(): Promise<void> {
  for (let turn = 0; turn < READ_HOLD_MACROTASKS; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

void vi.mock('fs', () => ({
  ...actualFs,
  promises: {
    ...actualFs.promises,
    readFile: async (
      filePath: string,
      encoding: BufferEncoding,
    ): Promise<string> => {
      if (holdReads) {
        await holdForMacrotaskTurns();
      }
      return actualPromises.readFile(filePath, encoding);
    },
  },
}));

const { TodoStore } = await import('./todo-store.js');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasTodoArray(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.todos);
}

function todoIds(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.todos)) {
    return ['invalid-todo-file'];
  }
  return value.todos.filter(isRecord).map((todo) => String(todo['id']));
}

function isPaused(value: unknown): boolean {
  return isRecord(value) && value.paused === true;
}

describe('TodoStore queue keying across alias-spelled data directories', () => {
  let root = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-store-aliasing-'));
    holdReads = false;
  });

  afterEach(() => {
    holdReads = false;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serializes complementary writes from dataDirs that normalize to one directory', async () => {
    const canonicalDir = path.join(root, 'data');
    const aliasDir = path.join(root, 'data', '..', 'data');
    expect(path.normalize(aliasDir)).toBe(canonicalDir);

    const seedingStore = new TodoStore('session-alias', {
      dataDir: canonicalDir,
    });
    await seedingStore.writeTodos([
      { id: 'seed', content: 'seed todo', status: 'pending' },
    ]);

    holdReads = true;
    const listStore = new TodoStore('session-alias', { dataDir: canonicalDir });
    const pauseStore = new TodoStore('session-alias', { dataDir: aliasDir });

    await Promise.all([
      listStore.writeTodos([
        { id: 'one', content: 'first todo', status: 'pending' },
      ]),
      pauseStore.writePausedState(true),
    ]);
    holdReads = false;

    const raw: unknown = JSON.parse(
      fs.readFileSync(
        path.join(canonicalDir, 'todos', 'todo-session-alias.json'),
        'utf-8',
      ),
    );
    expect(hasTodoArray(raw)).toBe(true);
    expect(todoIds(raw)).toStrictEqual(['one']);
    expect(isPaused(raw)).toBe(true);
  });
});
