/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const mockShellExecutionService = vi.hoisted(() => vi.fn());
const mockOsHomedir = vi.hoisted(() => vi.fn(() => '/home/user'));
const mockOsTmpdir = vi.hoisted(() => vi.fn(() => '/tmp'));
const mockOsPlatform = vi.hoisted(() => vi.fn(() => 'linux'));
vi.mock('../services/shellExecutionService.js', () => ({
  ShellExecutionService: { execute: mockShellExecutionService },
}));
vi.mock('fs');
vi.mock('os', () => ({
  default: {
    homedir: mockOsHomedir,
    tmpdir: mockOsTmpdir,
    platform: mockOsPlatform,
  },
  homedir: mockOsHomedir,
  tmpdir: mockOsTmpdir,
  platform: mockOsPlatform,
}));
vi.mock('crypto');

import { ShellTool } from './shell.js';
import type { Config } from '../config/config.js';
// import * as os from 'os';
import * as crypto from 'crypto';

// helper to create a deferred
function deferred<T>() {
  let resolve!: (v: T) => void;
  const p = new Promise<T>((res) => (resolve = res));
  return { promise: p, resolve };
}

type ExecResult = {
  rawOutput: Buffer;
  output: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error: Error | null;
  aborted: boolean;
  pid: number | undefined;
  executionMethod: 'lydell-node-pty' | 'node-pty' | 'child_process' | 'none';
};

describe('ShellTool multibyte handling', () => {
  const MULTIBYTE = 'ありがとう 世界';
  let tool: ShellTool;
  let config: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    config = {
      getCoreTools: vi.fn().mockReturnValue(undefined),
      getExcludeTools: vi.fn().mockReturnValue(undefined),
      getDebugMode: vi.fn().mockReturnValue(false),
      getTargetDir: vi.fn().mockReturnValue('/work'),
      getSummarizeToolOutputConfig: vi.fn().mockReturnValue(undefined),
      getGeminiClient: vi.fn(),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getShouldUseNodePtyShell: vi.fn().mockReturnValue(false),
      getAllowPtyThemeOverride: vi.fn().mockReturnValue(false),
      getShellExecutionConfig: vi.fn().mockReturnValue({
        showColor: false,
        scrollback: 600000,
        terminalWidth: 80,
        terminalHeight: 24,
      }),
      getPtyTerminalWidth: vi.fn().mockReturnValue(80),
      getPtyTerminalHeight: vi.fn().mockReturnValue(24),
    } as unknown as Config;

    tool = new ShellTool(config);

    mockOsPlatform.mockReturnValue('linux');
    mockOsTmpdir.mockReturnValue('/tmp');
    (vi.mocked(crypto.randomBytes) as unknown as Mock).mockReturnValue(
      Buffer.from('a1b2c3', 'hex'),
    );

    mockShellExecutionService.mockImplementation(
      (
        _cmd: string,
        _cwd: string,
        _cb: (e: unknown) => void,
        _signal: AbortSignal,
      ) => {
        const d = deferred<ExecResult>();
        return {
          pid: 11111,
          result: d.promise,
        };
      },
    );
  });

  it('preserves full multibyte output in returnDisplay', async () => {
    const abortSignal = new AbortController().signal;

    // Arrange mock to return our deferred then resolve after calling execute
    let resolveNow!: (v: ExecResult) => void;
    mockShellExecutionService.mockImplementationOnce(
      (
        _cmd: string,
        _cwd: string,
        _cb: (e: unknown) => void,
        _signal: AbortSignal,
      ) => {
        const d = deferred<ExecResult>();
        resolveNow = d.resolve;
        return { pid: 11111, result: d.promise };
      },
    );

    const invocation = tool.build({ command: 'noop' });
    const execPromise = invocation.execute(abortSignal);

    resolveNow({
      rawOutput: Buffer.from(MULTIBYTE, 'utf8'),
      output: MULTIBYTE,
      stdout: MULTIBYTE,
      stderr: '',
      exitCode: 0,
      signal: null,
      error: null,
      aborted: false,
      pid: 11111,
      executionMethod: 'child_process',
    });

    const result = await execPromise;
    expect(result.returnDisplay).toContain(MULTIBYTE);
  });
});
