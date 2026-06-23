/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import EventEmitter from 'events';
import type {
  ShellOutputEvent,
  ShellExecutionConfig,
} from './shellExecutionService.js';
import { ShellExecutionService } from './shellExecutionService.js';

// Hoisted Mocks
const mockPtySpawn = vi.hoisted(() => vi.fn());
const mockCpSpawn = vi.hoisted(() => vi.fn());
const mockIsBinary = vi.hoisted(() => vi.fn());
const mockPlatform = vi.hoisted(() => vi.fn());
const mockGetPty = vi.hoisted(() => vi.fn());

// Top-level Mocks
vi.mock('@lydell/node-pty', () => ({
  spawn: mockPtySpawn,
}));
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

const mockProcessKill = vi
  .spyOn(process, 'kill')
  .mockImplementation(() => true);

const shellExecutionConfig: ShellExecutionConfig = {
  terminalWidth: 80,
  terminalHeight: 24,
  pager: 'cat',
  showColor: false,
  disableDynamicLineTrimming: true,
};

describe('ShellExecutionService', () => {
  let mockPtyProcess: EventEmitter & {
    pid: number;
    kill: Mock;
    onData: Mock;
    onExit: Mock;
  };
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIsBinary.mockReturnValue(false);
    mockPlatform.mockReturnValue('linux');
    mockGetPty.mockResolvedValue({
      module: { spawn: mockPtySpawn },
      name: 'mock-pty',
    });

    onOutputEventMock = vi.fn();

    mockPtyProcess = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: Mock;
      onData: Mock;
      onExit: Mock;
      write: Mock;
    };
    mockPtyProcess.pid = 12345;
    mockPtyProcess.kill = vi.fn();
    mockPtyProcess.onData = vi.fn().mockReturnValue({ dispose: vi.fn() });
    mockPtyProcess.onExit = vi.fn().mockReturnValue({ dispose: vi.fn() });
    mockPtyProcess.write = vi.fn();

    mockPtySpawn.mockReturnValue(mockPtyProcess);
  });

  // Default shell execution config for tests
  const defaultShellConfig = {
    showColor: false,
    scrollback: 600000,
    terminalWidth: 80,
    terminalHeight: 24,
  };

  // Helper function to run a standard execution simulation
  const simulateExecution = async (
    command: string,
    simulation: (
      ptyProcess: typeof mockPtyProcess,
      ac: AbortController,
    ) => void | Promise<void>,
    config = defaultShellConfig,
  ) => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      command,
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      config,
    );

    await new Promise((resolve) => setImmediate(resolve));
    await simulation(mockPtyProcess, abortController);
    const result = await handle.result;
    return { result, handle, abortController };
  };

  describe('Successful Execution', () => {
    it('should execute a command and capture output', async () => {
      const { result, handle } = await simulateExecution(
        'ls -l',
        async (pty) => {
          pty.onData.mock.calls[0][0]('file1.txt\n');
          // Allow the async processing chain to complete before exit
          await new Promise((resolve) => setImmediate(resolve));
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
      );

      expect(mockPtySpawn).toHaveBeenCalledWith(
        'bash',
        [
          '-c',
          'shopt -u promptvars nullglob extglob nocaseglob dotglob; ls -l',
        ],
        expect.any(Object),
      );
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.error).toBeNull();
      expect(result.aborted).toBe(false);
      expect(result.output).toBe('file1.txt');
      expect(handle.pid).toBe(12345);

      // PTY mode emits AnsiOutput format, not plain strings
      expect(onOutputEventMock).toHaveBeenCalledWith({
        type: 'data',
        chunk: expect.any(Array), // AnsiOutput is an array
      });
    });

    it('should strip ANSI codes from output', async () => {
      const { result } = await simulateExecution(
        'ls --color=auto',
        async (pty) => {
          pty.onData.mock.calls[0][0]('a\u001b[31mred\u001b[0mword');
          // Allow the async processing chain to complete before exit
          await new Promise((resolve) => setImmediate(resolve));
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
      );

      expect(result.output).toBe('aredword');
      // PTY mode emits AnsiOutput format, not plain strings
      expect(onOutputEventMock).toHaveBeenCalledWith({
        type: 'data',
        chunk: expect.any(Array), // AnsiOutput is an array
      });
    });

    it('should correctly decode multi-byte characters split across chunks', async () => {
      const { result } = await simulateExecution('echo "你好"', async (pty) => {
        const multiByteChar = '你好';
        pty.onData.mock.calls[0][0](multiByteChar.slice(0, 1));
        pty.onData.mock.calls[0][0](multiByteChar.slice(1));
        // Allow the async processing chain to complete before exit
        await new Promise((resolve) => setImmediate(resolve));
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });
      expect(result.output).toBe('你好');
    });

    it('should handle commands with no output', async () => {
      const { result } = await simulateExecution('touch file', (pty) => {
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(result.output).toBe('');
      expect(onOutputEventMock).not.toHaveBeenCalled();
    });

    it('should capture large output (10000 lines)', async () => {
      const lineCount = 10000;
      const lines = Array.from({ length: lineCount }, (_, i) => `line ${i}`);
      const expectedOutput = lines.join('\n');

      const { result } = await simulateExecution(
        'large-output-command',
        (pty) => {
          const chunkSize = 1000;
          for (let i = 0; i < lineCount; i += chunkSize) {
            const chunk = lines.slice(i, i + chunkSize).join('\r\n') + '\r\n';
            pty.onData.mock.calls[0][0](chunk);
          }
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
      );

      expect(result.exitCode).toBe(0);
      const processedOutput = result.output
        .split('\n')
        .map((l) => l.trimEnd())
        .join('\n')
        .trim();
      expect(processedOutput).toBe(expectedOutput);
      expect(result.output.split('\n').length).toBeGreaterThanOrEqual(
        lineCount,
      );
    });

    it('should not wrap long lines in the final output', async () => {
      // Set a small width to force wrapping
      const narrowConfig = { ...shellExecutionConfig, terminalWidth: 10 };
      const longString = '123456789012345'; // 15 chars, should wrap at 10

      const { result } = await simulateExecution(
        'long-line-command',
        (pty) => {
          pty.onData.mock.calls[0][0](longString);
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
        narrowConfig,
      );

      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(longString);
    });

    it('should not add extra padding but preserve explicit trailing whitespace', async () => {
      const { result } = await simulateExecution('cmd', (pty) => {
        pty.onData.mock.calls[0][0]('value\r\nvalue2    ');
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(result.output).toBe('value\nvalue2    ');
    });

    it('should truncate output exceeding the scrollback limit', async () => {
      const scrollbackLimit = 100;
      const totalLines = 150;
      const lines = Array.from({ length: totalLines }, (_, i) => `line ${i}`);

      const { result } = await simulateExecution(
        'overflow-command',
        (pty) => {
          const chunk = lines.join('\r\n') + '\r\n';
          pty.onData.mock.calls[0][0](chunk);
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
        { ...shellExecutionConfig, scrollback: scrollbackLimit },
      );

      expect(result.exitCode).toBe(0);

      const outputLines = result.output
        .trim()
        .split('\n')
        .map((l) => l.trimEnd());

      expect(outputLines.length).toBeLessThan(totalLines);
      expect(outputLines[0]).not.toBe('line 0');

      expect(outputLines[outputLines.length - 1]).toBe(
        `line ${totalLines - 1}`,
      );
    });

    it('should call onPid with the process id', async () => {
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'ls -l',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        shellExecutionConfig,
      );
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      await handle.result;
      expect(handle.pid).toBe(12345);
    });
  });

  describe('Failed Execution', () => {
    it('should capture a non-zero exit code', async () => {
      const { result } = await simulateExecution(
        'a-bad-command',
        async (pty) => {
          pty.onData.mock.calls[0][0]('command not found');
          // Allow the async processing chain to complete before exit
          await new Promise((resolve) => setImmediate(resolve));
          pty.onExit.mock.calls[0][0]({ exitCode: 127, signal: null });
        },
      );

      expect(result.exitCode).toBe(127);
      expect(result.output).toBe('command not found');
      expect(result.error).toBeNull();
    });

    it('should capture a termination signal', async () => {
      const { result } = await simulateExecution('long-process', (pty) => {
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: 15 });
      });

      expect(result.exitCode).toBe(0);
      expect(result.signal).toBe(15);
    });

    it('should handle a synchronous spawn error', async () => {
      mockGetPty.mockImplementation(() => null);

      mockCpSpawn.mockImplementation(() => {
        throw new Error('Simulated PTY spawn error');
      });

      const handle = await ShellExecutionService.execute(
        'any-command',
        '/test/dir',
        onOutputEventMock,
        new AbortController().signal,
        true,
        defaultShellConfig,
      );
      const result = await handle.result;

      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toContain('Simulated PTY spawn error');
      expect(result.exitCode).toBe(1);
      expect(result.output).toBe('');
      expect(handle.pid).toBeUndefined();
    });
  });

  describe('Aborting Commands', () => {
    it('should abort a running process and set the aborted flag', async () => {
      const { result } = await simulateExecution(
        'sleep 10',
        async (pty, abortController) => {
          abortController.abort();
          // Wait for the abort handler to send SIGTERM
          await new Promise((resolve) => setImmediate(resolve));
          pty.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
        },
      );

      expect(result.aborted).toBe(true);
      // With improved abort handling, we use process.kill with SIGTERM first
      expect(mockProcessKill).toHaveBeenCalledWith(
        -mockPtyProcess.pid,
        'SIGTERM',
      );
    });

    it('should send SIGTERM and then SIGKILL on abort', async () => {
      const sigkillPromise = new Promise<void>((resolve) => {
        mockProcessKill.mockImplementation((pid, signal) => {
          if (signal === 'SIGKILL' && pid === -mockPtyProcess.pid) {
            resolve();
          }
          return true;
        });
      });

      const { result } = await simulateExecution(
        'long-running-process',
        async (pty, abortController) => {
          abortController.abort();
          await sigkillPromise; // Wait for SIGKILL to be sent before exiting.
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: 9 });
        },
      );

      expect(result.aborted).toBe(true);

      // Verify the calls were made in the correct order.
      const killCalls = mockProcessKill.mock.calls;
      const sigtermCallIndex = killCalls.findIndex(
        (call) => call[0] === -mockPtyProcess.pid && call[1] === 'SIGTERM',
      );
      const sigkillCallIndex = killCalls.findIndex(
        (call) => call[0] === -mockPtyProcess.pid && call[1] === 'SIGKILL',
      );

      expect(sigtermCallIndex).toBe(0);
      expect(sigkillCallIndex).toBe(1);
      expect(sigtermCallIndex).toBeLessThan(sigkillCallIndex);

      expect(result.signal).toBe(9);
    });

    it('should resolve without waiting for the processing chain on abort', async () => {
      const { result } = await simulateExecution(
        'long-output',
        (pty, abortController) => {
          // Simulate a lot of data being in the queue to be processed
          for (let i = 0; i < 1000; i++) {
            pty.onData.mock.calls[0][0]('some data');
          }
          abortController.abort();
          pty.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
        },
      );

      // The main assertion here is implicit: the `await` for the result above
      // should complete without timing out. This proves that the resolution
      // was not blocked by the long chain of data processing promises,
      // which is the desired behavior on abort.
      expect(result.aborted).toBe(true);
    });
  });

  describe('Inactivity Timeout', () => {
    it('should reset inactivity timer when output is received', async () => {
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'test command',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        {
          ...defaultShellConfig,
          inactivityTimeoutMs: 100, // 100ms for fast test
        },
      );

      await new Promise((resolve) => setImmediate(resolve));

      // Emit output every 50ms (within the 100ms inactivity window)
      const outputInterval = setInterval(() => {
        if (mockPtyProcess.onData.mock.calls.length > 0) {
          mockPtyProcess.onData.mock.calls[0][0]('output\n');
        }
      }, 50);

      // Wait 250ms (should reset timer multiple times)
      await new Promise((resolve) => setTimeout(resolve, 250));
      clearInterval(outputInterval);

      // Command exits normally
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      const result = await handle.result;

      // Command should complete successfully, not be killed by inactivity timeout
      expect(result.exitCode).toBe(0);
      expect(result.aborted).toBe(false);
    });

    it('should kill command when no output for inactivityTimeout duration', async () => {
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'hanging command',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        {
          ...defaultShellConfig,
          inactivityTimeoutMs: 100, // 100ms for fast test
        },
      );

      await new Promise((resolve) => setImmediate(resolve));

      // Emit one line of output
      mockPtyProcess.onData.mock.calls[0][0]('initial output\n');
      await new Promise((resolve) => setImmediate(resolve));

      // Then go silent for longer than inactivity timeout
      // Wait for the timeout to trigger and kill signal to be sent
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Simulate the PTY exiting after being killed
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 1, signal: 15 });

      const result = await handle.result;

      // Command should be terminated by SIGTERM due to inactivity
      expect(result.signal).toBe(15); // SIGTERM
      expect(result.inactivityTimedOut).toBe(true);
      // Verify SIGTERM was sent
      expect(mockProcessKill).toHaveBeenCalledWith(-12345, 'SIGTERM');
    });

    it('should handle inactivity timeout independently from total timeout', async () => {
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'test command',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        {
          ...defaultShellConfig,
          inactivityTimeoutMs: 50, // 50ms inactivity timeout
        },
      );

      await new Promise((resolve) => setImmediate(resolve));

      // Set up a total timeout of 200ms
      const totalTimeout = setTimeout(() => abortController.abort(), 200);

      // Emit output at intervals shorter than inactivity timeout
      mockPtyProcess.onData.mock.calls[0][0]('output 1\n');
      await new Promise((resolve) => setTimeout(resolve, 30));

      mockPtyProcess.onData.mock.calls[0][0]('output 2\n');
      await new Promise((resolve) => setTimeout(resolve, 30));

      mockPtyProcess.onData.mock.calls[0][0]('output 3\n');

      // Now go silent - inactivity timeout should fire before total timeout (at ~110ms)
      const result = await handle.result;
      clearTimeout(totalTimeout);

      // Should be killed by inactivity timeout, not total timeout
      expect(result.aborted).toBe(true);
      expect(result.inactivityTimedOut).toBe(true);
      expect(mockProcessKill).toHaveBeenCalled();
    });
  });

  describe('Binary Output', () => {
    it('should detect binary output and switch to progress events', async () => {
      // Must use mockReturnValue since isBinary is called asynchronously in the processing chain
      mockIsBinary.mockReturnValue(true);
      const binaryChunk1 = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const binaryChunk2 = Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]);

      const { result } = await simulateExecution(
        'cat image.png',
        async (pty) => {
          pty.onData.mock.calls[0][0](binaryChunk1);
          pty.onData.mock.calls[0][0](binaryChunk2);
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
      );

      expect(result.rawOutput).toStrictEqual(
        Buffer.concat([binaryChunk1, binaryChunk2]),
      );
      // PTY binary detection emits binary_detected, then subsequent chunks emit binary_progress
      // Due to the async processing chain, we verify at least binary_detected and one progress
      expect(onOutputEventMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(onOutputEventMock.mock.calls[0][0]).toStrictEqual({
        type: 'binary_detected',
      });
      // Verify at least one binary_progress event was emitted
      const progressEvents = onOutputEventMock.mock.calls.filter(
        (call: [{ type: string }]) => call[0].type === 'binary_progress',
      );
      expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should not emit data events after binary is detected', async () => {
      mockIsBinary.mockImplementation((buffer) => buffer.includes(0x00));

      await simulateExecution('cat mixed_file', async (pty) => {
        pty.onData.mock.calls[0][0](Buffer.from('some text'));
        await new Promise((resolve) => setImmediate(resolve));
        pty.onData.mock.calls[0][0](Buffer.from([0x00, 0x01, 0x02]));
        await new Promise((resolve) => setImmediate(resolve));
        pty.onData.mock.calls[0][0](Buffer.from('more text'));
        await new Promise((resolve) => setImmediate(resolve));
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      const eventTypes = onOutputEventMock.mock.calls.map(
        (call: [ShellOutputEvent]) => call[0].type,
      );
      // PTY mode with xterm terminal may not emit initial data event before binary detection
      // depending on timing; the key invariant is no 'data' after 'binary_detected'
      expect(eventTypes).toStrictEqual([
        'binary_detected',
        'binary_progress',
        'binary_progress',
      ]);
    });
  });

  describe('Platform-Specific Behavior', () => {
    it('should use powershell.exe on Windows', async () => {
      mockPlatform.mockReturnValue('win32');
      await simulateExecution('dir "foo bar"', (pty) =>
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null }),
      );

      expect(mockPtySpawn).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoProfile', '-Command', 'dir "foo bar"'],
        expect.any(Object),
      );
    });

    it('should use bash on Linux', async () => {
      mockPlatform.mockReturnValue('linux');
      await simulateExecution('ls "foo bar"', (pty) =>
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null }),
      );

      expect(mockPtySpawn).toHaveBeenCalledWith(
        'bash',
        [
          '-c',
          'shopt -u promptvars nullglob extglob nocaseglob dotglob; ls "foo bar"',
        ],
        expect.any(Object),
      );
    });
  });

  describe('Resource cleanup', () => {
    it('should track PTY in writeToPty after creation', async () => {
      await simulateExecution('echo test', (pty) => {
        ShellExecutionService.writeToPty(pty.pid, 'input');
        expect(pty.write).toHaveBeenCalledWith('input');
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });
    });

    it('should not write to PTY after normal exit', async () => {
      mockPtyProcess.write = vi.fn();
      const pid = mockPtyProcess.pid;

      await simulateExecution('echo test', (pty) => {
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      await new Promise((resolve) => setImmediate(resolve));

      ShellExecutionService.writeToPty(pid, 'input');
      expect(mockPtyProcess.write).not.toHaveBeenCalled();
    });

    it('should not write to PTY after abort', async () => {
      mockPtyProcess.write = vi.fn();
      const pid = mockPtyProcess.pid;

      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'sleep 10',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        defaultShellConfig,
      );

      await new Promise((resolve) => setImmediate(resolve));

      abortController.abort();
      await new Promise((resolve) => setImmediate(resolve));
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
      await handle.result;

      await new Promise((resolve) => setImmediate(resolve));

      ShellExecutionService.writeToPty(pid, 'input');
      expect(mockPtyProcess.write).not.toHaveBeenCalled();
    });

    it('should dispose PTY event listener disposables on normal exit', async () => {
      const onDataDispose = vi.fn();
      const onExitDispose = vi.fn();
      mockPtyProcess.onData = vi
        .fn()
        .mockReturnValue({ dispose: onDataDispose });
      mockPtyProcess.onExit = vi
        .fn()
        .mockReturnValue({ dispose: onExitDispose });

      await simulateExecution('echo cleanup', async (pty) => {
        pty.onData.mock.calls[0][0]('output\n');

        await new Promise((resolve) => setImmediate(resolve));
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(onDataDispose).toHaveBeenCalled();
      expect(onExitDispose).toHaveBeenCalled();
    });

    it('should dispose PTY event listener disposables on abort', async () => {
      const onDataDispose = vi.fn();
      const onExitDispose = vi.fn();
      mockPtyProcess.onData = vi
        .fn()
        .mockReturnValue({ dispose: onDataDispose });
      mockPtyProcess.onExit = vi
        .fn()
        .mockReturnValue({ dispose: onExitDispose });

      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'sleep 10',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        defaultShellConfig,
      );

      await new Promise((resolve) => setImmediate(resolve));

      abortController.abort();
      await new Promise((resolve) => setImmediate(resolve));
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
      await handle.result;

      expect(onDataDispose).toHaveBeenCalled();
      expect(onExitDispose).toHaveBeenCalled();
    });

    it('should kill the PTY process on normal exit cleanup', async () => {
      await simulateExecution('echo cleanup-kill', async (pty) => {
        pty.onData.mock.calls[0][0]('output\n');
        await new Promise((resolve) => setImmediate(resolve));
        pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      });

      expect(mockPtyProcess.kill).toHaveBeenCalled();
    });

    it('should not throw when PTY kill fails during cleanup', async () => {
      mockPtyProcess.kill.mockImplementation(() => {
        throw new Error('PTY already exited');
      });

      const { result } = await simulateExecution(
        'echo cleanup-safe',
        async (pty) => {
          pty.onData.mock.calls[0][0]('output\n');
          await new Promise((resolve) => setImmediate(resolve));
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
      );

      expect(result.exitCode).toBe(0);
    });
  });

  describe('destroyAllPtys', () => {
    it('should terminate and clean up all active PTYs', async () => {
      const secondMockPty = {
        pid: 99999,
        kill: vi.fn(),
        onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        write: vi.fn(),
      };

      mockPtySpawn.mockReturnValueOnce(mockPtyProcess);

      const ac1 = new AbortController();
      const handle1 = await ShellExecutionService.execute(
        'sleep 100',
        '/test/dir',
        onOutputEventMock,
        ac1.signal,
        true,
        defaultShellConfig,
      );
      await new Promise((resolve) => setImmediate(resolve));

      mockPtySpawn.mockReturnValueOnce(secondMockPty);

      const ac2 = new AbortController();
      const handle2 = await ShellExecutionService.execute(
        'sleep 200',
        '/test/dir',
        onOutputEventMock,
        ac2.signal,
        true,
        defaultShellConfig,
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(ShellExecutionService.isActivePty(mockPtyProcess.pid)).toBe(true);
      expect(ShellExecutionService.isActivePty(secondMockPty.pid)).toBe(true);

      ShellExecutionService.destroyAllPtys();

      expect(mockPtyProcess.kill).toHaveBeenCalled();
      expect(secondMockPty.kill).toHaveBeenCalled();
      expect(ShellExecutionService.isActivePty(mockPtyProcess.pid)).toBe(false);
      expect(ShellExecutionService.isActivePty(secondMockPty.pid)).toBe(false);

      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
      secondMockPty.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
      await Promise.all([handle1.result, handle2.result]);
    });

    it('should be safe to call when no PTYs are active', () => {
      expect(() => ShellExecutionService.destroyAllPtys()).not.toThrow();
    });

    it('should prefer destroy() over kill() when destroy is available', async () => {
      const destroyMock = vi.fn();
      const ptyWithDestroy = {
        pid: 77777,
        kill: vi.fn(),
        destroy: destroyMock,
        onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        write: vi.fn(),
      };

      mockPtySpawn.mockReturnValueOnce(ptyWithDestroy);

      const ac = new AbortController();
      const handle = await ShellExecutionService.execute(
        'sleep 1',
        '/test/dir',
        onOutputEventMock,
        ac.signal,
        true,
        defaultShellConfig,
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(ShellExecutionService.isActivePty(77777)).toBe(true);

      ShellExecutionService.destroyAllPtys();

      expect(destroyMock).toHaveBeenCalled();
      expect(ptyWithDestroy.kill).not.toHaveBeenCalled();
      expect(ShellExecutionService.isActivePty(77777)).toBe(false);

      ptyWithDestroy.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
      await handle.result;
    });

    it('should fall back to kill() when destroy is not available', async () => {
      mockPtySpawn.mockReturnValueOnce(mockPtyProcess);

      const ac = new AbortController();
      const handle = await ShellExecutionService.execute(
        'sleep 1',
        '/test/dir',
        onOutputEventMock,
        ac.signal,
        true,
        defaultShellConfig,
      );
      await new Promise((resolve) => setImmediate(resolve));

      ShellExecutionService.destroyAllPtys();

      expect(mockPtyProcess.kill).toHaveBeenCalled();

      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 1, signal: null });
      await handle.result;
    });
  });

  describe('abort-race listener cleanup', () => {
    it('should remove the race abort listener after processing completes', async () => {
      const abortController = new AbortController();
      const addSpy = vi.spyOn(abortController.signal, 'addEventListener');
      const removeSpy = vi.spyOn(abortController.signal, 'removeEventListener');

      const handle = await ShellExecutionService.execute(
        'echo listener-test',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        defaultShellConfig,
      );

      await new Promise((resolve) => setImmediate(resolve));

      mockPtyProcess.onData.mock.calls[0][0]('output\n');

      await new Promise((resolve) => setImmediate(resolve));
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      await handle.result;

      // Collect every abort callback that was added
      const addedCallbacks = addSpy.mock.calls
        .filter((call) => call[0] === 'abort')
        .map((call) => call[1]);

      // Collect every abort callback that was removed
      const removedCallbacks = removeSpy.mock.calls
        .filter((call) => call[0] === 'abort')
        .map((call) => call[1]);

      // Every added callback must have been removed with the exact same reference
      for (const cb of addedCallbacks) {
        expect(removedCallbacks).toContain(cb);
      }
    });

    it('should clean up the race abort listener when processing rejects (catch path)', async () => {
      const abortController = new AbortController();
      const addSpy = vi.spyOn(abortController.signal, 'addEventListener');
      const removeSpy = vi.spyOn(abortController.signal, 'removeEventListener');

      const handle = await ShellExecutionService.execute(
        'echo race-error',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        defaultShellConfig,
      );

      await new Promise((resolve) => setImmediate(resolve));

      // Inject a rejection into the processing chain by providing data whose
      // handling will throw inside the headless terminal write callback.
      // We accomplish this by making isBinary throw, which poisons the
      // processingChain promise with a rejection.
      mockIsBinary.mockImplementationOnce(() => {
        throw new Error('simulated processing failure');
      });
      mockPtyProcess.onData.mock.calls[0][0]('trigger-error');

      await new Promise((resolve) => setImmediate(resolve));

      // Now fire onExit — the race will hit the .catch() path because
      // processingChain (which isBinary poisoned) rejects.
      mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
      const result = await handle.result;

      // The command should still resolve successfully despite the processing error
      expect(result.exitCode).toBe(0);

      // Collect every abort callback that was added
      const addedCallbacks = addSpy.mock.calls
        .filter((call) => call[0] === 'abort')
        .map((call) => call[1]);

      // Collect every abort callback that was removed
      const removedCallbacks = removeSpy.mock.calls
        .filter((call) => call[0] === 'abort')
        .map((call) => call[1]);

      // Every added callback must have been removed with the exact same reference
      for (const cb of addedCallbacks) {
        expect(removedCallbacks).toContain(cb);
      }
    });
  });
});
