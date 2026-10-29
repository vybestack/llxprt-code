/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #1542: formatSessionEntry must handle the
 * { todos, paused } envelope format that TodoStore writes to disk.
 *
 * Uses real temp files instead of an fs module mock: bun's vi.mock('fs')
 * patches the shared module namespace for sibling test files in the same
 * process, which poisoned readFileSync for unrelated journal reads (#854).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatSessionEntry } from './todoFormatters.js';
import type { TodoSessionFile } from './todoOperations.js';

let tmpDir: string;
let fileCounter = 0;

function makeFile(content: string): TodoSessionFile {
  fileCounter += 1;
  const filePath = path.join(tmpDir, `todo-${fileCounter}.json`);
  fs.writeFileSync(filePath, content, 'utf8');
  return {
    name: path.basename(filePath),
    path: filePath,
    mtime: new Date(),
  };
}

function envelope(
  todos: ReadonlyArray<{ id: string; content: string; status: string }>,
  paused: boolean,
): string {
  return JSON.stringify({ todos, paused });
}

describe('formatSessionEntry (issue #1542 envelope format)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-formatters-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads an envelope-format file { todos, paused } without "(error reading file)"', () => {
    const file = makeFile(
      envelope(
        [
          { id: '1', content: 'Task A', status: 'pending' },
          { id: '2', content: 'Task B', status: 'in_progress' },
        ],
        false,
      ),
    );

    const lines = formatSessionEntry(file, 0);

    const joined = lines.join('\n');
    expect(joined).not.toContain('(error reading file)');
    expect(joined).toContain('2 items');
    expect(joined).toContain('Task A');
  });

  it('reads a legacy bare-array format file', () => {
    const file = makeFile(
      JSON.stringify([
        { id: '1', content: 'Legacy task', status: 'completed' },
      ]),
    );

    const lines = formatSessionEntry(file, 0);

    const joined = lines.join('\n');
    expect(joined).not.toContain('(error reading file)');
    expect(joined).toContain('1 items');
    expect(joined).toContain('Legacy task');
  });

  it('shows "(error reading file)" only for genuinely corrupted content', () => {
    const file = makeFile('{ not valid json');

    const lines = formatSessionEntry(file, 0);

    expect(lines[0]).toContain('(error reading file)');
  });

  it('handles an empty envelope { todos: [], paused: false }', () => {
    const file = makeFile(envelope([], false));

    const lines = formatSessionEntry(file, 0);

    const joined = lines.join('\n');
    expect(joined).not.toContain('(error reading file)');
    expect(joined).toContain('0 items');
    expect(joined).toContain('(empty)');
  });

  it('includes a status summary for envelope with mixed statuses', () => {
    const file = makeFile(
      envelope(
        [
          { id: '1', content: 'Done', status: 'completed' },
          { id: '2', content: 'Active', status: 'in_progress' },
          { id: '3', content: 'Waiting', status: 'pending' },
        ],
        false,
      ),
    );

    const lines = formatSessionEntry(file, 0);

    const joined = lines.join('\n');
    expect(joined).not.toContain('(error reading file)');
    expect(joined).toContain('3 items');
    expect(joined).toContain('in_progress');
    expect(joined).toContain('pending');
    expect(joined).toContain('completed');
  });
});
