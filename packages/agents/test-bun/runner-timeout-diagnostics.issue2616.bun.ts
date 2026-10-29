/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';

import {
  describeTaskkillProbe,
  describeTimedOutChild,
  findDescendants,
  parseProcessTable,
  type CommandResult,
  type RunCommand,
} from '../runner-timeout-diagnostics.js';

const TABLE_JSON = JSON.stringify([
  {
    ProcessId: 10,
    ParentProcessId: 1,
    Name: 'bun.exe',
    CommandLine: 'bun test',
  },
  {
    ProcessId: 11,
    ParentProcessId: 10,
    Name: 'cmd.exe',
    CommandLine: 'cmd /c x',
  },
  { ProcessId: 12, ParentProcessId: 11, Name: 'node.exe', CommandLine: null },
  {
    ProcessId: 20,
    ParentProcessId: 1,
    Name: 'other.exe',
    CommandLine: 'other',
  },
]);

function ok(stdout: string): CommandResult {
  return { status: 0, stdout, stderr: '' };
}

describe('parseProcessTable', () => {
  it('reads every row, keeping a missing command line as null', () => {
    const table = parseProcessTable(TABLE_JSON);
    expect(table).toHaveLength(4);
    expect(table[2]).toEqual({
      pid: 12,
      parentPid: 11,
      name: 'node.exe',
      commandLine: null,
    });
  });

  it('accepts the bare object PowerShell emits for a single row', () => {
    const table = parseProcessTable(
      JSON.stringify({
        ProcessId: 5,
        ParentProcessId: 4,
        Name: 'a',
        CommandLine: 'a',
      }),
    );
    expect(table.map((record) => record.pid)).toEqual([5]);
  });

  it('rejects a row without numeric ids', () => {
    expect(() => parseProcessTable(JSON.stringify([{ Name: 'x' }]))).toThrow(
      'lacks numeric ids',
    );
  });
});

describe('findDescendants', () => {
  it('walks the whole subtree and excludes the root and unrelated processes', () => {
    const found = findDescendants(10, parseProcessTable(TABLE_JSON));
    expect(found.map((record) => record.pid)).toEqual([11, 12]);
  });

  it('finds orphans of a root that is no longer in the table', () => {
    const withoutRoot = parseProcessTable(TABLE_JSON).filter(
      (record) => record.pid !== 10,
    );
    expect(findDescendants(10, withoutRoot).map((r) => r.pid)).toEqual([
      11, 12,
    ]);
  });

  it('terminates on a parent cycle', () => {
    const cyclic = parseProcessTable(
      JSON.stringify([
        { ProcessId: 2, ParentProcessId: 3, Name: 'a', CommandLine: 'a' },
        { ProcessId: 3, ParentProcessId: 2, Name: 'b', CommandLine: 'b' },
      ]),
    );
    expect(findDescendants(2, cyclic).map((r) => r.pid)).toEqual([3]);
  });
});

describe('describeTimedOutChild', () => {
  it('reports the observed exit and each live descendant with its command line', () => {
    const runCommand: RunCommand = () => ok(TABLE_JSON);
    const text = describeTimedOutChild({
      file: 'src/a.test.ts',
      rootPid: 10,
      exit: { code: 0, signal: null },
      runCommand,
    });
    expect(text).toContain('src/a.test.ts (root pid 10)');
    expect(text).toContain('child exit event observed (code=0, signal=null)');
    expect(text).toContain('pid=11 ppid=10 name=cmd.exe cmd=cmd /c x');
    expect(text).toContain('pid=12 ppid=11 name=node.exe');
    expect(text).toContain('(command line unavailable)');
  });

  it('says so when the exit event never fired', () => {
    const text = describeTimedOutChild({
      file: 'f',
      rootPid: 10,
      exit: null,
      runCommand: () => ok(TABLE_JSON),
    });
    expect(text).toContain('child exit event NOT observed');
  });

  it('reports a failed process query instead of hiding it', () => {
    const text = describeTimedOutChild({
      file: 'f',
      rootPid: 10,
      exit: null,
      runCommand: () => ({ status: 1, stdout: '', stderr: 'access denied' }),
    });
    expect(text).toContain('process query failed (status 1): access denied');
  });

  it('reports an empty descendant set', () => {
    const text = describeTimedOutChild({
      file: 'f',
      rootPid: 99,
      exit: null,
      runCommand: () => ok(TABLE_JSON),
    });
    expect(text).toContain('no descendant processes alive');
  });
});

describe('describeTaskkillProbe', () => {
  it('prints taskkill status and stderr, then the surviving descendants', () => {
    const calls: string[] = [];
    const runCommand: RunCommand = (command, args) => {
      calls.push([command, ...args].join(' '));
      if (command === 'taskkill') {
        return { status: 255, stdout: '', stderr: 'ERROR: not found' };
      }
      return ok(TABLE_JSON);
    };
    const text = describeTaskkillProbe(10, runCommand);
    expect(calls[0]).toBe('taskkill /PID 10 /T /F');
    expect(text).toContain('status 255');
    expect(text).toContain('stderr: ERROR: not found');
    expect(text).toContain('pid=11 ppid=10');
  });
});
