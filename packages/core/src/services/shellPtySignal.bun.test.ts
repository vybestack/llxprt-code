/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import EventEmitter from 'node:events';
import { beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import type { ShellOutputEvent } from './shellExecutionService.js';

/**
 * Focused Bun boundary evidence for issue 2980 REQ-2980-4: the node-pty
 * exit-result boundary must normalize a clean-exit signal of 0 to null and an
 * omitted/undefined signal to null, while preserving every nonzero signal.
 *
 * The ShellExecutionService PTY path is driven with a fake pty whose onExit
 * callback is invoked directly, so the exact node-pty callback shape
 * ({ exitCode, signal }) is exercised without spawning a real process. The
 * service is imported dynamically AFTER the getPty module mock is registered
 * so the mock applies to the service's module graph. No public production
 * abstraction is added for testing.
 */

interface FakePtyExit {
  exitCode: number;
  signal?: number;
}

type ExitHandler = (exit: FakePtyExit) => void;

interface FakePty extends EventEmitter {
  pid: number;
  kill: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  emitExit: (exit: FakePtyExit) => void;
}

let fakePty: FakePty;

// getPty is mocked so ShellExecutionService takes the PTY path with a
// controllable fake pty instead of resolving the real (Bun/native) pty.
await mock.module('../utils/getPty.js', () => ({
  getPty: async () => ({
    module: { spawn: () => fakePty },
    name: 'mock-pty',
  }),
}));

const { ShellExecutionService } = await import('./shellExecutionService.js');

const defaultShellConfig = {
  showColor: false,
  scrollback: 600000,
  terminalWidth: 80,
  terminalHeight: 24,
};

function buildFakePty(): FakePty {
  const pty = new EventEmitter() as FakePty;
  let exitHandler: ExitHandler = () => undefined;
  pty.pid = 4242;
  pty.kill = vi.fn();
  pty.onData = vi.fn().mockReturnValue({ dispose: vi.fn() });
  pty.onExit = vi.fn((handler: ExitHandler) => {
    exitHandler = handler;
    return { dispose: vi.fn() };
  });
  pty.write = vi.fn();
  pty.resize = vi.fn();
  pty.emitExit = (exit: FakePtyExit) => exitHandler(exit);
  return pty;
}

/** Drives the PTY path to completion with the given onExit payload. */
async function executeAndExit(
  payload: FakePtyExit,
): Promise<{ exitCode: number; signal: number | string | null }> {
  const onOutputEvent = (_event: ShellOutputEvent): void => undefined;
  const handle = await ShellExecutionService.execute(
    'clean-process',
    '/test/dir',
    onOutputEvent,
    new AbortController().signal,
    true,
    defaultShellConfig,
  );
  // Let the spawn + handler registration settle before firing exit.
  await new Promise((resolve) => setImmediate(resolve));
  fakePty.emitExit(payload);
  const result = await handle.result;
  return { exitCode: result.exitCode, signal: result.signal };
}

describe('ShellExecutionService PTY exit signal normalization (issue 2980)', () => {
  beforeEach(() => {
    fakePty = buildFakePty();
  });

  it('normalizes a clean-exit signal of 0 to null', async () => {
    const { exitCode, signal } = await executeAndExit({
      exitCode: 0,
      signal: 0,
    });
    expect(exitCode).toBe(0);
    expect(signal).toBeNull();
  });

  it('normalizes an omitted signal to null', async () => {
    const { exitCode, signal } = await executeAndExit({ exitCode: 0 });
    expect(exitCode).toBe(0);
    expect(signal).toBeNull();
  });

  it('preserves a nonzero termination signal', async () => {
    const { exitCode, signal } = await executeAndExit({
      exitCode: 0,
      signal: 15,
    });
    expect(exitCode).toBe(0);
    expect(signal).toBe(15);
  });
});
