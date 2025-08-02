/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as os from 'os';
import { spawn } from 'child_process';

vi.mock('os');

// create a controllable fake child each time spawn is called
type Listener = (...args: unknown[]) => void;

const fakeChildFactory = () => {
  const child = {
    stdout: { on: vi.fn<(event: string, cb: Listener) => void>() },
    stderr: { on: vi.fn<(event: string, cb: Listener) => void>() },
    on: vi.fn<(event: string, cb: Listener) => void>(),
    pid: 2222,
    kill: vi.fn<(signal?: NodeJS.Signals) => boolean>(),
  };
  return child;
};

vi.mock('child_process', async (orig) => {
  const mod = (await orig()) as typeof import('child_process');
  return {
    ...mod,
    spawn: vi.fn(() => fakeChildFactory()),
  };
});

vi.mock('../utils/systemEncoding.js', () => ({
  getSystemEncoding: vi.fn().mockReturnValue('shift_jis'),
}));

vi.mock('strip-ansi', () => ({ default: (s: string) => s }));
vi.mock('../utils/textUtils.js', () => ({ isBinary: () => false }));

import { ShellExecutionService } from './shellExecutionService.js';

function makeAbortSignal() {
  const c = new AbortController();
  return c.signal;
}

describe('ShellExecutionService (Windows behavior)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.platform).mockReturnValue('win32');
  });

  it('uses cmd.exe with /d /s /c when operators present', async () => {
    ShellExecutionService.execute(
      'echo a & echo b',
      '.',
      () => {},
      makeAbortSignal(),
    );
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/cmd\.exe/i),
      ['/d', '/s', '/c', 'echo a & echo b'],
      expect.objectContaining({ shell: false }),
    );
  });

  it('spawns program directly when no operators present', async () => {
    ShellExecutionService.execute('node -v', '.', () => {}, makeAbortSignal());
    expect(spawn).toHaveBeenCalledWith('node', ['-v'], expect.any(Object));
  });

  it('initializes TextDecoder with system encoding mapping (CP932->shift_jis) and decodes stderr bytes', async () => {
    // simulate stderr chunk containing Shift-JIS bytes for some Japanese chars
    const sjisBytes = Buffer.from([0x93, 0xfa, 0x96, 0x7b]);

    // Capture handlers for the just-spawned child
    const stdoutHandlers: Listener[] = [];
    const stderrHandlers: Listener[] = [];
    const exitHandlers: Listener[] = [];

    (
      spawn as unknown as {
        mockImplementationOnce: (
          fn: () => ReturnType<typeof fakeChildFactory>,
        ) => void;
      }
    ).mockImplementationOnce(() => {
      const child = fakeChildFactory();
      child.stdout.on.mockImplementation((_ev: string, cb: Listener) => {
        stdoutHandlers.push(cb);
      });
      child.stderr.on.mockImplementation((_ev: string, cb: Listener) => {
        stderrHandlers.push(cb);
      });
      child.on.mockImplementation((ev: string, cb: Listener) => {
        if (ev === 'exit') exitHandlers.push(cb);
      });
      return child;
    });

    const { result } = ShellExecutionService.execute(
      'cmd /c',
      '.',
      () => {},
      makeAbortSignal(),
    );

    // emit stderr data and exit 0
    stderrHandlers.forEach((cb) => cb(sjisBytes));
    exitHandlers.forEach((cb) => cb(0, null));

    const out = await result;
    expect(out.stderr.length).toBeGreaterThan(0);
  });
});
