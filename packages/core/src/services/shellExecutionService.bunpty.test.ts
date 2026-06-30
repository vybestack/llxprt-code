/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import EventEmitter from 'events';
import type { ShellOutputEvent } from './shellExecutionService.js';
import { ShellExecutionService } from './shellExecutionService.js';

// Hoisted Mocks
const mockCpSpawn = vi.hoisted(() => vi.fn());
const mockIsBinary = vi.hoisted(() => vi.fn());
const mockPlatform = vi.hoisted(() => vi.fn());
const mockGetPty = vi.hoisted(() => vi.fn());

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    spawn: mockCpSpawn,
  };
});
vi.mock('../utils/textUtils.js', () => ({
  isBinary: mockIsBinary,
}));
vi.mock('os', () => ({
  default: {
    platform: mockPlatform,
    homedir: () => '/tmp/test-home',
    constants: {
      signals: {
        SIGTERM: 15,
        SIGKILL: 9,
      },
    },
  },
  platform: mockPlatform,
  homedir: () => '/tmp/test-home',
  constants: {
    signals: {
      SIGTERM: 15,
      SIGKILL: 9,
    },
  },
}));
vi.mock('../utils/getPty.js', () => ({
  getPty: mockGetPty,
}));

/**
 * Silent-hang guard for the bun-pty backend.
 *
 * Simulates the pathological backend that spawns (returns a pid) but never
 * emits data or exit events — the exact failure mode of @lydell/node-pty under
 * Bun POSIX. The test verifies that the watchdog tears the PTY down and the
 * service degrades to child_process, observable through the resolved result's
 * executionMethod, not through mock-call assertions.
 */
describe('ShellExecutionService bun-pty silent-hang guard', () => {
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;
  let mockChildProcess: EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    pid: number;
    kill: Mock;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockImplementation(() => true);

    mockIsBinary.mockReturnValue(false);
    mockPlatform.mockReturnValue('linux');

    onOutputEventMock = vi.fn();

    mockChildProcess = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      pid: number;
      kill: Mock;
    };
    mockChildProcess.stdout = new EventEmitter();
    mockChildProcess.stderr = new EventEmitter();
    mockChildProcess.kill = vi.fn();
    mockChildProcess.pid = 54321;

    mockCpSpawn.mockReturnValue(mockChildProcess);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /**
   * Build a PTY backend that spawns but never fires onData/onExit — the
   * pathological silent-hang. Only `pid`, `onData`, `onExit`, `kill`,
   * `write`, and `resize` are needed by the lifecycle seam.
   */
  function createMockPty(): {
    pid: number;
    onData: Mock;
    onExit: Mock;
    kill: Mock;
    write: Mock;
    resize: Mock;
    clear: Mock;
    process: string;
    handleFlowControl: boolean;
    cols: number;
    rows: number;
    pause: Mock;
    resume: Mock;
    emitData(data: string): void;
    emitExit(event: { exitCode: number; signal?: number | null }): void;
  } {
    let dataListener: ((data: string) => void) | undefined;
    let exitListener:
      | ((event: { exitCode: number; signal?: number | null }) => void)
      | undefined;
    return {
      pid: 99999,
      onData: vi.fn((listener: (data: string) => void) => {
        dataListener = listener;
        return { dispose: vi.fn() };
      }),
      onExit: vi.fn(
        (
          listener: (event: {
            exitCode: number;
            signal?: number | null;
          }) => void,
        ) => {
          exitListener = listener;
          return { dispose: vi.fn() };
        },
      ),
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      clear: vi.fn(),
      process: 'bash',
      handleFlowControl: false,
      cols: 80,
      rows: 24,
      pause: vi.fn(),
      resume: vi.fn(),
      emitData(data: string): void {
        if (!dataListener) {
          throw new Error('onData listener was not registered');
        }
        dataListener(data);
      },
      emitExit(event: { exitCode: number; signal?: number | null }): void {
        if (!exitListener) {
          throw new Error('onExit listener was not registered');
        }
        exitListener(event);
      },
    };
  }

  it('falls back to child_process when bun-pty emits no data or exit', async () => {
    const hangingPty = createMockPty();
    mockGetPty.mockResolvedValue({
      module: { spawn: vi.fn().mockReturnValue(hangingPty) },
      name: 'bun-pty',
    });

    const config = {
      showColor: false,
      terminalWidth: 80,
      terminalHeight: 24,
      ptyWatchdogTimeoutMs: 2000,
    };

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'echo hello',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      config,
    );

    // The handle initially reports the PTY pid.
    expect(handle.pid).toBe(99999);

    // Advance time past the watchdog threshold. The PTY never fires, so the
    // watchdog should fire and trigger fallback.
    await vi.advanceTimersByTimeAsync(2100);
    await Promise.resolve();

    // Now simulate child_process output + exit for the fallback.
    mockChildProcess.stdout.emit('data', Buffer.from('hello\n'));
    mockChildProcess.emit('exit', 0, null);

    const result = await handle.result;

    // Observable: the result completed via child_process fallback, not the
    // hung PTY. executionMethod and result pid prove the degradation path.
    expect(result.pid).toBe(54321);
    expect(result.executionMethod).toBe('child_process');
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('hello');
    // The hung PTY was torn down.
    expect(hangingPty.kill).toHaveBeenCalled();
  });

  it('surfaces child_process spawn errors when watchdog fallback cannot start', async () => {
    const hangingPty = createMockPty();
    const spawnError = new Error('spawn EACCES');
    mockGetPty.mockResolvedValue({
      module: { spawn: vi.fn().mockReturnValue(hangingPty) },
      name: 'bun-pty',
    });
    mockCpSpawn.mockImplementationOnce(() => {
      throw spawnError;
    });

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'echo hello',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      {
        showColor: false,
        terminalWidth: 80,
        terminalHeight: 24,
        ptyWatchdogTimeoutMs: 2000,
      },
    );

    await vi.advanceTimersByTimeAsync(2100);

    const result = await handle.result;

    expect(handle.pid).toBe(99999);
    expect(result.pid).toBeUndefined();
    expect(result.executionMethod).toBe('none');
    expect(result.exitCode).toBe(1);
    expect(result.error).toBe(spawnError);
    expect(hangingPty.kill).toHaveBeenCalled();
  });

  it('aborts a silent bun-pty without racing into child_process fallback', async () => {
    const hangingPty = createMockPty();
    mockGetPty.mockResolvedValue({
      module: { spawn: vi.fn().mockReturnValue(hangingPty) },
      name: 'bun-pty',
    });

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'sleep 30',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      {
        showColor: false,
        terminalWidth: 80,
        terminalHeight: 24,
        ptyWatchdogTimeoutMs: 2000,
      },
    );

    abortController.abort();
    await vi.advanceTimersByTimeAsync(500);

    const result = await handle.result;

    expect(result.executionMethod).toBe('bun-pty');
    expect(result.aborted).toBe(true);
    expect(mockCpSpawn).not.toHaveBeenCalled();
    expect(hangingPty.kill).toHaveBeenCalled();
  });
  it('does not trigger the watchdog when bun-pty emits data promptly', async () => {
    const responsivePty = createMockPty();
    mockGetPty.mockResolvedValue({
      module: { spawn: vi.fn().mockReturnValue(responsivePty) },
      name: 'bun-pty',
    });

    const config = {
      showColor: false,
      terminalWidth: 80,
      terminalHeight: 24,
      ptyWatchdogTimeoutMs: 2000,
    };

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'echo ok',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      config,
    );

    responsivePty.emitData('ok\r\n');
    await vi.advanceTimersByTimeAsync(100);
    responsivePty.emitExit({ exitCode: 0, signal: null });

    const result = await handle.result;

    expect(result.executionMethod).toBe('bun-pty');
    expect(result.exitCode).toBe(0);
    expect(mockCpSpawn).not.toHaveBeenCalled();
  });

  it('does not trigger the watchdog after partial data while exit is delayed', async () => {
    const slowPty = createMockPty();
    mockGetPty.mockResolvedValue({
      module: { spawn: vi.fn().mockReturnValue(slowPty) },
      name: 'bun-pty',
    });

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'echo slow',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      {
        showColor: false,
        terminalWidth: 80,
        terminalHeight: 24,
        ptyWatchdogTimeoutMs: 2000,
      },
    );

    slowPty.emitData('partial');
    await vi.advanceTimersByTimeAsync(3000);

    expect(mockCpSpawn).not.toHaveBeenCalled();
    expect(slowPty.kill).not.toHaveBeenCalled();

    slowPty.emitExit({ exitCode: 0, signal: null });

    const result = await handle.result;

    expect(result.executionMethod).toBe('bun-pty');
    expect(result.exitCode).toBe(0);
    expect(mockCpSpawn).not.toHaveBeenCalled();
  });
  it('cancels the watchdog when bun-pty exits with no data output', async () => {
    const hangingPty = createMockPty();
    mockGetPty.mockResolvedValue({
      module: { spawn: vi.fn().mockReturnValue(hangingPty) },
      name: 'bun-pty',
    });

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'true',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      {
        showColor: false,
        terminalWidth: 80,
        terminalHeight: 24,
        ptyWatchdogTimeoutMs: 2000,
      },
    );

    hangingPty.emitExit({ exitCode: 0, signal: null });
    await vi.advanceTimersByTimeAsync(2100);

    const result = await handle.result;

    expect(result.executionMethod).toBe('bun-pty');
    expect(result.exitCode).toBe(0);
    expect(mockCpSpawn).not.toHaveBeenCalled();
  });

  it('does not apply the watchdog to lydell-node-pty (Node timing unchanged)', async () => {
    const nodePty = createMockPty();
    mockGetPty.mockResolvedValue({
      module: { spawn: vi.fn().mockReturnValue(nodePty) },
      name: 'lydell-node-pty',
    });

    const config = {
      showColor: false,
      terminalWidth: 80,
      terminalHeight: 24,
      ptyWatchdogTimeoutMs: 500,
    };

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'echo no-watchdog',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      config,
    );

    // Advance well past what would be the watchdog timeout for bun-pty.
    await vi.advanceTimersByTimeAsync(2000);

    // The lydell-node-pty backend should NOT have fallen back — the watchdog
    // is bun-pty-only. The result is still pending (no exit emitted).
    expect(mockCpSpawn).not.toHaveBeenCalled();
    expect(nodePty.kill).not.toHaveBeenCalled();

    // Clean up: emit exit so the test doesn't leave hanging promises.
    nodePty.emitExit({ exitCode: 0, signal: null });
    await handle.result;
  });
});
