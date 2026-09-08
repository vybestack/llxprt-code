/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

interface TmuxProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number;
  readonly error: undefined;
}

function successfulTmuxProcess(): TmuxProcessResult {
  return {
    stdout: '',
    stderr: '',
    status: 0,
    error: undefined,
  };
}

const spawnSyncMock = vi.fn((..._args: readonly unknown[]) =>
  successfulTmuxProcess(),
);
const actualChildProcess = { ...(await import('node:child_process')) };

void vi.mock('node:child_process', () => ({
  ...actualChildProcess,
  spawnSync: (...args: readonly unknown[]) => spawnSyncMock(...args),
}));

const { executeStepDispatch } = await import('../tmux-harness-steps.ts');
const { cleanupTmuxSocketDir, getTmuxSocketPath } = await import(
  '../tmux-harness-io.ts'
);

type DispatchContext = Parameters<typeof executeStepDispatch>[2];

function createContext(): DispatchContext {
  return {
    sessionName: 'issue2017-session',
    outDir: 'tmp/verify2017/resize-test',
    sendKeys: async () => undefined,
    scriptState: { historySamples: [] },
    defaults: {
      postTypeMs: 0,
      submitKeys: ['Enter'],
      shellSubmitKeys: ['Enter'],
      timeoutMs: 100,
      pollMs: 10,
      scrollbackLines: 100,
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function findTmuxArgs(command: string): string[] | undefined {
  for (const call of spawnSyncMock.mock.calls) {
    const args = call[1];
    if (isStringArray(args) && args.includes(command)) {
      return args;
    }
  }
  return undefined;
}

function tmuxInvocations(): string[][] {
  const invocations: string[][] = [];
  for (const call of spawnSyncMock.mock.calls) {
    const args = call[1];
    if (isStringArray(args)) {
      invocations.push(args);
    }
  }
  return invocations;
}

beforeEach(() => {
  spawnSyncMock.mockClear();
  spawnSyncMock.mockImplementation((..._args: readonly unknown[]) =>
    successfulTmuxProcess(),
  );
});

afterEach(() => {
  cleanupTmuxSocketDir();
});

describe('tmux harness resize step', () => {
  it('resizes the active test window through the isolated tmux server', async () => {
    await executeStepDispatch(
      { type: 'resize', cols: 58, rows: 24, settleMs: 0 },
      3,
      createContext(),
    );

    const expectedArgs = [
      process.platform === 'win32' ? '-L' : '-S',
      getTmuxSocketPath(),
      'resize-window',
      '-t',
      'issue2017-session',
      '-x',
      '58',
      '-y',
      '24',
    ];
    expect(findTmuxArgs('resize-window')).toEqual(expectedArgs);
    expect(tmuxInvocations()).toEqual([expectedArgs]);
  });

  it.each([
    ['cols', 0, 24],
    ['cols', -1, 24],
    ['cols', 58.5, 24],
    ['cols', Number.POSITIVE_INFINITY, 24],
    ['rows', 58, 0],
    ['rows', 58, -1],
    ['rows', 58, 24.5],
    ['rows', 58, Number.NaN],
  ] as const)(
    'rejects invalid %s before invoking tmux',
    async (field, cols, rows) => {
      const result = executeStepDispatch(
        { type: 'resize', cols, rows, settleMs: 0 },
        3,
        createContext(),
      );

      await expect(result).rejects.toThrow(`Invalid resize.${field}`);
      expect(findTmuxArgs('resize-window')).toBeUndefined();
    },
  );

  it.each([-1, Number.POSITIVE_INFINITY, Number.NaN])(
    'rejects invalid settleMs %p before invoking tmux',
    async (settleMs) => {
      const result = executeStepDispatch(
        { type: 'resize', cols: 58, rows: 24, settleMs },
        3,
        createContext(),
      );

      await expect(result).rejects.toThrow('Invalid resize.settleMs');
      expect(findTmuxArgs('resize-window')).toBeUndefined();
    },
  );

  it('continues to reject unknown step types', async () => {
    const result = executeStepDispatch(
      { type: 'resize-unknown' },
      3,
      createContext(),
    );

    await expect(result).rejects.toThrow('Unknown step.type: resize-unknown');
  });
});
