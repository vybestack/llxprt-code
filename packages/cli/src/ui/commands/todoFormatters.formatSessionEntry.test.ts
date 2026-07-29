/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #1542: formatSessionEntry must handle the
 * { todos, paused } envelope format that TodoStore writes to disk.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatSessionEntry } from './todoFormatters.js';
import type { TodoSessionFile } from './todoOperations.js';

// vi.mock is hoisted above imports — the factory must not reference any
// top-level variable. vi.hoisted gives us a stable mock function that is
// available both inside the factory and in the test body.
const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: readFileSyncMock,
}));

function makeFile(path: string, mtime: Date): TodoSessionFile {
  return { name: path.split('/').pop()!, path, mtime };
}

describe('formatSessionEntry (issue #1542 envelope format)', () => {
  beforeEach(() => {
    readFileSyncMock.mockReset();
  });

  it('reads an envelope-format file { todos, paused } without "(error reading file)"', () => {
    const todos = [
      { id: '1', content: 'Task A', status: 'pending' },
      { id: '2', content: 'Task B', status: 'in_progress' },
    ];
    readFileSyncMock.mockReturnValue(JSON.stringify({ todos, paused: false }));

    const file = makeFile('/fake/todo-1.json', new Date());
    const lines = formatSessionEntry(file, 0);

    const joined = lines.join('\n');
    expect(joined).not.toContain('(error reading file)');
    expect(joined).toContain('2 items');
    expect(joined).toContain('Task A');
  });

  it('reads a legacy bare-array format file', () => {
    const todos = [{ id: '1', content: 'Legacy task', status: 'completed' }];
    readFileSyncMock.mockReturnValue(JSON.stringify(todos));

    const file = makeFile('/fake/todo-2.json', new Date());
    const lines = formatSessionEntry(file, 0);

    const joined = lines.join('\n');
    expect(joined).not.toContain('(error reading file)');
    expect(joined).toContain('1 items');
    expect(joined).toContain('Legacy task');
  });

  it('shows "(error reading file)" only for genuinely corrupted content', () => {
    readFileSyncMock.mockReturnValue('{ not valid json');

    const file = makeFile('/fake/todo-broken.json', new Date());
    const lines = formatSessionEntry(file, 0);

    expect(lines[0]).toContain('(error reading file)');
  });

  it('handles an empty envelope { todos: [], paused: false }', () => {
    readFileSyncMock.mockReturnValue(
      JSON.stringify({ todos: [], paused: false }),
    );

    const file = makeFile('/fake/todo-empty.json', new Date());
    const lines = formatSessionEntry(file, 0);

    const joined = lines.join('\n');
    expect(joined).not.toContain('(error reading file)');
    expect(joined).toContain('0 items');
    expect(joined).toContain('(empty)');
  });

  it('includes a status summary for envelope with mixed statuses', () => {
    const todos = [
      { id: '1', content: 'Done', status: 'completed' },
      { id: '2', content: 'Active', status: 'in_progress' },
      { id: '3', content: 'Waiting', status: 'pending' },
    ];
    readFileSyncMock.mockReturnValue(JSON.stringify({ todos, paused: false }));

    const file = makeFile('/fake/todo-mixed.json', new Date());
    const lines = formatSessionEntry(file, 0);

    const joined = lines.join('\n');
    expect(joined).not.toContain('(error reading file)');
    expect(joined).toContain('3 items');
    expect(joined).toContain('in_progress');
    expect(joined).toContain('pending');
    expect(joined).toContain('completed');
  });
});
