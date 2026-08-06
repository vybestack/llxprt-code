/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { spawn } from 'child_process';

const mockPlatform = vi.fn(() => 'win32');
const __actual = { ...(await import('os')) };
vi.mock('os', () => {
  const actual = __actual as typeof import('os');
  return { ...actual, platform: mockPlatform };
});

// create a controllable fake child each time spawn is called
type Listener = (...args: unknown[]) => void;

const fakeChildFactory = () => {
  const child = {
    stdout: { on: vi.fn<(event: string, cb: Listener) => void>() },
    stderr: { on: vi.fn<(event: string, cb: Listener) => void>() },
    on: vi.fn<(event: string, cb: Listener) => void>(),
    once: vi.fn<(event: string, cb: Listener) => void>(),
    pid: 2222,
    kill: vi.fn<(signal?: NodeJS.Signals) => boolean>(),
  };
  return child;
};

const realChildProcessModule = { ...(await import('child_process')) };

vi.mock('child_process', () => ({
  ...realChildProcessModule,
  spawn: vi.fn(() => fakeChildFactory()),
}));

vi.mock('../utils/systemEncoding.js', () => ({
  getSystemEncoding: vi.fn().mockReturnValue('shift_jis'),
  getCachedEncodingForBuffer: vi.fn().mockReturnValue('shift_jis'),
}));

vi.mock('strip-ansi', () => ({ default: (s: string) => s }));
vi.mock('../utils/textUtils.js', () => ({ isBinary: () => false }));

import { ShellExecutionService } from './shellExecutionService.js';

function makeAbortSignal() {
  const c = new AbortController();
  return c.signal;
}

const isWindows = process.platform === 'win32';

describe('ShellExecutionService (Windows behavior)', () => {
  beforeEach(() => {
    if (!isWindows) return;
    vi.clearAllMocks();
    mockPlatform.mockReturnValue('win32');
  });

  it.skipIf(!isWindows)(
    'uses PowerShell without shell: true on Windows',
    async () => {
      await ShellExecutionService.execute(
        'echo a & echo b',
        '.',
        () => {},
        makeAbortSignal(),
        false,
      );
      expect(spawn).toHaveBeenCalledWith(
        expect.stringMatching(/powershell\.exe$/i),
        ['-NoProfile', '-Command', 'echo a & echo b'],
        expect.objectContaining({
          shell: false,
          windowsVerbatimArguments: false,
        }),
      );
    },
  );

  it.skipIf(!isWindows)(
    'uses PowerShell without shell: true on Windows for simple commands',
    async () => {
      await ShellExecutionService.execute(
        'node -v',
        '.',
        () => {},
        makeAbortSignal(),
        false,
      );
      expect(spawn).toHaveBeenCalledWith(
        expect.stringMatching(/powershell\.exe$/i),
        ['-NoProfile', '-Command', 'node -v'],
        expect.objectContaining({
          shell: false,
          windowsVerbatimArguments: false,
        }),
      );
    },
  );
});
