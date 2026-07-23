/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral round-trip/parity tests for TodoStore storage dependency
 * injection.
 *
 * TodoStore must resolve its `todos/` directory through a single injected
 * authority rather than duplicating the global platform data-dir algorithm.
 * The injected path honors the canonical Storage contract: DATA override
 * takes precedence, then compatibility CONFIG override, then platform
 * default. The tools package remains a leaf package (no Storage import);
 * the data-dir authority is injected explicitly at every construction site.
 *
 * These tests exercise real filesystem round-trips (write todos, read them
 * back) using temp directories injected via the explicit constructor
 * dependency. No mocks of TodoStore.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { TodoStore } from './todo-store.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'todo-store-injection-'));
}

describe('TodoStore — explicit data-dir authority (no global resolver)', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('throws at construction when no data-dir dependency is provided', () => {
    // The XOR union makes `{}` a type error, but a runtime guard remains for
    // defensive construction. Cast through unknown to exercise the runtime
    // guard without disabling type-checking elsewhere.
    expect(
      () =>
        new TodoStore(
          'session-1',
          {} as unknown as { dataDirResolver: undefined; dataDir: undefined },
        ),
    ).toThrow(/path.*string|explicit data directory/i);
  });

  it('writes todos into the injected data dir and reads them back (round-trip)', async () => {
    const injectedDataDir = path.join(tempRoot, 'data');

    const store = new TodoStore('session-1', {
      dataDirResolver: () => injectedDataDir,
    });
    await store.writeTodos([
      {
        id: 't1',
        content: 'Write tests',
        status: 'in_progress',
        subtasks: [
          { id: 's1', content: 'red' },
          { id: 's2', content: 'green' },
        ],
      },
    ]);

    // The todos file lives under the injected data dir, not a duplicated
    // platform-default location.
    const expectedFile = path.join(
      injectedDataDir,
      'todos',
      'todo-session-1.json',
    );
    expect(fs.existsSync(expectedFile)).toBe(true);

    const readBack = await store.readTodos();
    expect(readBack).toHaveLength(1);
    // Assert the full written object is preserved (not just the id), so a
    // partial-write or serialization bug that drops content/status/subtasks
    // is caught.
    expect(readBack[0]?.id).toBe('t1');
    expect(readBack[0]?.content).toBe('Write tests');
    expect(readBack[0]?.status).toBe('in_progress');
    expect(readBack[0]?.subtasks).toEqual([
      { id: 's1', content: 'red' },
      { id: 's2', content: 'green' },
    ]);
  });

  it('uses the fixed dataDir option (string form) for a round-trip', async () => {
    const fixed = path.join(tempRoot, 'fixed');
    const store = new TodoStore('sess-fixed', { dataDir: fixed });
    await store.writeTodos([
      { id: 'f1', content: 'fixed', status: 'pending', subtasks: [] },
    ]);
    expect(
      fs.existsSync(path.join(fixed, 'todos', 'todo-sess-fixed.json')),
    ).toBe(true);
  });

  it('isolates agent-scoped todos under the injected data dir', async () => {
    const injectedDataDir = path.join(tempRoot, 'agents');

    const store = new TodoStore(
      'session-1',
      { dataDirResolver: () => injectedDataDir },
      'agent-7',
    );
    await store.writeTodos([
      { id: 'a1', content: 'agent task', status: 'pending', subtasks: [] },
    ]);

    const expected = path.join(
      injectedDataDir,
      'todos',
      'todo-session-1-agent-7.json',
    );
    expect(fs.existsSync(expected)).toBe(true);
  });

  it('isolates separate sessions under separate injected dirs', async () => {
    const dirA = path.join(tempRoot, 'a');
    const storeA = new TodoStore('sess-a', { dataDirResolver: () => dirA });
    await storeA.writeTodos([
      { id: 'x', content: 'A', status: 'pending', subtasks: [] },
    ]);
    expect(fs.existsSync(path.join(dirA, 'todos', 'todo-sess-a.json'))).toBe(
      true,
    );

    const dirB = path.join(tempRoot, 'b');
    const storeB = new TodoStore('sess-b', { dataDirResolver: () => dirB });
    await storeB.writeTodos([
      { id: 'y', content: 'B', status: 'pending', subtasks: [] },
    ]);
    expect(fs.existsSync(path.join(dirB, 'todos', 'todo-sess-b.json'))).toBe(
      true,
    );
    // dirA was the authority when storeA was constructed.
    expect(fs.existsSync(path.join(dirA, 'todos', 'todo-sess-b.json'))).toBe(
      false,
    );
  });
});

describe('TodoStore — preserves paused state across writes', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('preserves paused state when writing todos', async () => {
    const dir = path.join(tempRoot, 'pause');
    const store = new TodoStore('sess', { dataDirResolver: () => dir });

    await store.writeTodos([
      { id: '1', content: 'task', status: 'pending', subtasks: [] },
    ]);
    await store.writePausedState(true);
    await store.writeTodos([
      { id: '1', content: 'task', status: 'in_progress', subtasks: [] },
    ]);

    expect(await store.readPausedState()).toBe(true);
  });
});

describe('TodoStore — XOR union and dynamic resolver', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('dataDirResolver is re-evaluated on each operation (dynamic path change)', async () => {
    // A resolver that switches from dirA to dirB after the first write proves
    // the resolver is re-evaluated per operation, not fixed at construction.
    // The second write's readFileData + writeFileData both resolve to dirB,
    // so the file lands in dirB — not dirA (the construction-time dir).
    const dirA = path.join(tempRoot, 'dyn-a');
    const dirB = path.join(tempRoot, 'dyn-b');
    let useB = false;
    const store = new TodoStore('sess-dyn', {
      dataDirResolver: () => (useB ? dirB : dirA),
    });

    // First write goes to dirA (construction + first resolve).
    await store.writeTodos([
      { id: 'd1', content: 'first', status: 'pending', subtasks: [] },
    ]);
    expect(fs.existsSync(path.join(dirA, 'todos', 'todo-sess-dyn.json'))).toBe(
      true,
    );

    // Flip the resolver to dirB. The second write must land in dirB, proving
    // the resolver is re-evaluated on the operation (not cached at
    // construction).
    useB = true;
    await store.writeTodos([
      { id: 'd2', content: 'second', status: 'pending', subtasks: [] },
    ]);
    expect(fs.existsSync(path.join(dirB, 'todos', 'todo-sess-dyn.json'))).toBe(
      true,
    );

    // Reading back resolves to dirB and returns the second write's content.
    const readBack = await store.readTodos();
    expect(readBack).toHaveLength(1);
    expect(readBack[0]?.id).toBe('d2');
  });

  it('fixed dataDir is stable across operations (no dynamic change)', async () => {
    const fixed = path.join(tempRoot, 'fixed-dyn');
    const store = new TodoStore('sess-fixed-dyn', { dataDir: fixed });

    await store.writeTodos([
      { id: 'f1', content: 'first', status: 'pending', subtasks: [] },
    ]);
    await store.writeTodos([
      { id: 'f2', content: 'second', status: 'pending', subtasks: [] },
    ]);

    // Both writes went to the same fixed dir.
    const file = path.join(fixed, 'todos', 'todo-sess-fixed-dyn.json');
    expect(fs.existsSync(file)).toBe(true);
    const readBack = await store.readTodos();
    expect(readBack).toHaveLength(1);
    expect(readBack[0]?.id).toBe('f2');
  });

  it('agent-specific path is honored via the dynamic resolver', async () => {
    const dir = path.join(tempRoot, 'agent-dyn');
    const store = new TodoStore(
      'sess-agent-dyn',
      { dataDirResolver: () => dir },
      'agent-dynamic',
    );
    await store.writeTodos([
      { id: 'a1', content: 'agent', status: 'pending', subtasks: [] },
    ]);
    expect(
      fs.existsSync(
        path.join(dir, 'todos', 'todo-sess-agent-dyn-agent-dynamic.json'),
      ),
    ).toBe(true);
  });
});
