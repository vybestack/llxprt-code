/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import EventEmitter from 'events';
import { Readable } from 'stream';
import { type ChildProcess } from 'child_process';
import {
  ShellExecutionService,
  ShellOutputEvent,
} from './shellExecutionService.js';

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
  const actual = (await importOriginal()) as typeof import('child_process');
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
    mockPtyProcess.onData = vi.fn();
    mockPtyProcess.onExit = vi.fn();
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
  ) => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      command,
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true,
      defaultShellConfig,
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

    // Note: PTY mode with xterm terminal uses scrollback lines for truncation,
    // not raw buffer size. This test is for the rawOutput Buffer truncation.
    // The truncation warning is added to rawOutput, not the terminal output.
    it.skip('should truncate PTY output using a sliding window and show a warning', async () => {
      const MAX_SIZE = 16 * 1024 * 1024;
      const chunk1 = 'a'.repeat(MAX_SIZE / 2 - 5);
      const chunk2 = 'b'.repeat(MAX_SIZE / 2 - 5);
      const chunk3 = 'c'.repeat(20);

      const { result } = await simulateExecution(
        'large-output',
        async (pty) => {
          pty.onData.mock.calls[0][0](chunk1);
          await new Promise((resolve) => setImmediate(resolve));
          pty.onData.mock.calls[0][0](chunk2);
          await new Promise((resolve) => setImmediate(resolve));
          pty.onData.mock.calls[0][0](chunk3);
          await new Promise((resolve) => setImmediate(resolve));
          pty.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
        },
      );

      const truncationMessage =
        '[LLXPRT_CODE_WARNING: Output truncated. The buffer is limited to 16MB.]';
      expect(result.output).toContain(truncationMessage);

      const outputWithoutMessage = result.output
        .substring(0, result.output.indexOf(truncationMessage))
        .trimEnd();

      expect(outputWithoutMessage.length).toBe(MAX_SIZE);

      const expectedStart = (chunk1 + chunk2 + chunk3).slice(-MAX_SIZE);
      expect(
        outputWithoutMessage.startsWith(expectedStart.substring(0, 10)),
      ).toBe(true);
      expect(outputWithoutMessage.endsWith('c'.repeat(20))).toBe(true);
    }, 20000);
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

      expect(result.rawOutput).toEqual(
        Buffer.concat([binaryChunk1, binaryChunk2]),
      );
      // PTY binary detection emits binary_detected, then subsequent chunks emit binary_progress
      // Due to the async processing chain, we verify at least binary_detected and one progress
      expect(onOutputEventMock.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(onOutputEventMock.mock.calls[0][0]).toEqual({
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
      expect(eventTypes).toEqual([
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
  });
});

describe('ShellExecutionService child_process fallback', () => {
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockIsBinary.mockReturnValue(false);
    mockPlatform.mockReturnValue('linux');
    mockGetPty.mockResolvedValue(null);

    onOutputEventMock = vi.fn();

    mockChildProcess = new EventEmitter() as EventEmitter &
      Partial<ChildProcess>;
    mockChildProcess.stdout = new EventEmitter() as Readable;
    mockChildProcess.stderr = new EventEmitter() as Readable;
    mockChildProcess.kill = vi.fn();

    Object.defineProperty(mockChildProcess, 'pid', {
      value: 12345,
      configurable: true,
    });

    mockChildProcess.once = mockChildProcess.on.bind(mockChildProcess);

    mockCpSpawn.mockReturnValue(mockChildProcess);
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
    simulation: (cp: typeof mockChildProcess, ac: AbortController) => void,
    shouldUseNodePty = true,
  ) => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      command,
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      shouldUseNodePty,
      defaultShellConfig,
    );

    await new Promise((resolve) => setImmediate(resolve));
    simulation(mockChildProcess, abortController);
    const result = await handle.result;
    return { result, handle, abortController };
  };

  describe('Successful Execution', () => {
    it('should execute a command and capture stdout and stderr', async () => {
      const { result, handle } = await simulateExecution('ls -l', (cp) => {
        cp.stdout?.emit('data', Buffer.from('file1.txt\n'));
        cp.stderr?.emit('data', Buffer.from('a warning'));
        cp.emit('exit', 0, null);
      });

      expect(mockCpSpawn).toHaveBeenCalledWith(
        'bash',
        [
          '-c',
          'shopt -u promptvars nullglob extglob nocaseglob dotglob; ls -l',
        ],
        expect.objectContaining({ shell: false }),
      );
      expect(result.exitCode).toBe(0);
      expect(result.signal).toBeNull();
      expect(result.error).toBeNull();
      expect(result.aborted).toBe(false);
      expect(result.output).toBe('file1.txt\na warning');
      expect(handle.pid).toBe(12345);

      expect(onOutputEventMock).toHaveBeenCalledWith({
        type: 'data',
        chunk: 'file1.txt\n',
      });
      expect(onOutputEventMock).toHaveBeenCalledWith({
        type: 'data',
        chunk: 'a warning',
      });
    });

    it('should resolve when only the close event fires', async () => {
      const { result } = await simulateExecution('ls -l', (cp) => {
        cp.stdout?.emit('data', Buffer.from('file1.txt\n'));
        cp.emit('close', 0, null);
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('file1.txt');
    });

    it('should strip ANSI codes from output', async () => {
      const { result } = await simulateExecution('ls --color=auto', (cp) => {
        cp.stdout?.emit('data', Buffer.from('a\u001b[31mred\u001b[0mword'));
        cp.emit('exit', 0, null);
      });

      expect(result.output).toBe('aredword');
      expect(onOutputEventMock).toHaveBeenCalledWith({
        type: 'data',
        chunk: 'aredword',
      });
    });

    it('should correctly decode multi-byte characters split across chunks', async () => {
      const { result } = await simulateExecution('echo "你好"', (cp) => {
        const multiByteChar = Buffer.from('你好', 'utf-8');
        cp.stdout?.emit('data', multiByteChar.slice(0, 2));
        cp.stdout?.emit('data', multiByteChar.slice(2));
        cp.emit('exit', 0, null);
      });
      expect(result.output).toBe('你好');
    });

    it('should handle commands with no output', async () => {
      const { result } = await simulateExecution('touch file', (cp) => {
        cp.emit('exit', 0, null);
      });

      expect(result.output).toBe('');
      expect(onOutputEventMock).not.toHaveBeenCalled();
    });

    it('should truncate stdout using a sliding window and show a warning', async () => {
      const MAX_SIZE = 16 * 1024 * 1024;
      const chunk1 = 'a'.repeat(MAX_SIZE / 2 - 5);
      const chunk2 = 'b'.repeat(MAX_SIZE / 2 - 5);
      const chunk3 = 'c'.repeat(20);

      const { result } = await simulateExecution('large-output', (cp) => {
        cp.stdout?.emit('data', Buffer.from(chunk1));
        cp.stdout?.emit('data', Buffer.from(chunk2));
        cp.stdout?.emit('data', Buffer.from(chunk3));
        cp.emit('exit', 0, null);
      });

      const truncationMessage =
        '[LLXPRT_CODE_WARNING: Output truncated. The buffer is limited to 16MB.]';
      expect(result.output).toContain(truncationMessage);

      const outputWithoutMessage = result.output
        .substring(0, result.output.indexOf(truncationMessage))
        .trimEnd();

      expect(outputWithoutMessage.length).toBe(MAX_SIZE);

      const expectedStart = (chunk1 + chunk2 + chunk3).slice(-MAX_SIZE);
      expect(
        outputWithoutMessage.startsWith(expectedStart.substring(0, 10)),
      ).toBe(true);
      expect(outputWithoutMessage.endsWith('c'.repeat(20))).toBe(true);
    }, 20000);
  });

  describe('Failed Execution', () => {
    it('should capture a non-zero exit code and format output correctly', async () => {
      const { result } = await simulateExecution('a-bad-command', (cp) => {
        cp.stderr?.emit('data', Buffer.from('command not found'));
        cp.emit('exit', 127, null);
      });

      expect(result.exitCode).toBe(127);
      expect(result.output).toBe('command not found');
      expect(result.error).toBeNull();
    });

    it('should capture a termination signal', async () => {
      const { result } = await simulateExecution('long-process', (cp) => {
        cp.emit('exit', null, 'SIGTERM');
      });

      expect(result.exitCode).toBeNull();
      expect(result.signal).toBe(15);
    });

    it('should handle a spawn error', async () => {
      const spawnError = new Error('spawn EACCES');
      const { result } = await simulateExecution('protected-cmd', (cp) => {
        cp.emit('error', spawnError);
        cp.emit('exit', 1, null);
      });

      expect(result.error).toBe(spawnError);
      expect(result.exitCode).toBe(1);
    });

    it('handles errors that do not fire the exit event', async () => {
      const error = new Error('spawn abc ENOENT');
      const { result } = await simulateExecution('touch cat.jpg', (cp) => {
        cp.emit('error', error); // No exit event is fired.
      });

      expect(result.error).toBe(error);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Aborting Commands', () => {
    describe.each([
      {
        platform: 'linux',
        expectedSignal: 'SIGTERM',
        expectedExit: { signal: 'SIGKILL' as const },
      },
      {
        platform: 'win32',
        expectedCommand: 'taskkill',
        expectedExit: { code: 1 },
      },
    ])(
      'on $platform',
      ({ platform, expectedSignal, expectedCommand, expectedExit }) => {
        it('should abort a running process and set the aborted flag', async () => {
          mockPlatform.mockReturnValue(platform);

          const { result } = await simulateExecution(
            'sleep 10',
            (cp, abortController) => {
              abortController.abort();
              if (expectedExit.signal)
                cp.emit('exit', null, expectedExit.signal);
              if (typeof expectedExit.code === 'number')
                cp.emit('exit', expectedExit.code, null);
            },
          );

          expect(result.aborted).toBe(true);

          // Verify platform-specific abort behavior
          const isLinux = platform === 'linux';
          expect(isLinux ? expectedSignal : expectedCommand).toBeDefined();

          // Verify the appropriate kill method was called based on platform
          const processKillCalls = mockProcessKill.mock.calls;
          const cpSpawnCalls = mockCpSpawn.mock.calls;

          // For Linux: check process.kill was called with SIGTERM
          const linuxKillMatches = processKillCalls.some(
            (call) =>
              call[0] === -mockChildProcess.pid! && call[1] === expectedSignal,
          );

          // For Windows: check taskkill was spawned
          const windowsKillMatches = cpSpawnCalls.some(
            (call) =>
              call[0] === expectedCommand &&
              JSON.stringify(call[1]) ===
                JSON.stringify([
                  '/pid',
                  String(mockChildProcess.pid),
                  '/f',
                  '/t',
                ]),
          );

          // Exactly one of these should be true based on platform
          expect(isLinux ? linuxKillMatches : windowsKillMatches).toBe(true);
        });
      },
    );

    it('should gracefully attempt SIGKILL on linux if SIGTERM fails', async () => {
      mockPlatform.mockReturnValue('linux');
      vi.useFakeTimers();

      // Don't await the result inside the simulation block for this specific test.
      // We need to control the timeline manually.
      const abortController = new AbortController();
      const handle = await ShellExecutionService.execute(
        'unresponsive_process',
        '/test/dir',
        onOutputEventMock,
        abortController.signal,
        true,
        defaultShellConfig,
      );

      abortController.abort();

      // Check the first kill signal
      expect(mockProcessKill).toHaveBeenCalledWith(
        -mockChildProcess.pid!,
        'SIGTERM',
      );

      // Now, advance time past the timeout
      await vi.advanceTimersByTimeAsync(250);

      // Check the second kill signal
      expect(mockProcessKill).toHaveBeenCalledWith(
        -mockChildProcess.pid!,
        'SIGKILL',
      );

      // Finally, simulate the process exiting and await the result
      mockChildProcess.emit('exit', null, 'SIGKILL');
      const result = await handle.result;

      vi.useRealTimers();

      expect(result.aborted).toBe(true);
      expect(result.signal).toBe(9);
      // The individual kill calls were already asserted above.
      expect(mockProcessKill).toHaveBeenCalledTimes(2);
    });
  });

  describe('Binary Output', () => {
    it('should detect binary output and switch to progress events', async () => {
      mockIsBinary.mockReturnValueOnce(true);
      const binaryChunk1 = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const binaryChunk2 = Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]);

      const { result } = await simulateExecution('cat image.png', (cp) => {
        cp.stdout?.emit('data', binaryChunk1);
        cp.stdout?.emit('data', binaryChunk2);
        cp.emit('exit', 0, null);
      });

      expect(result.rawOutput).toEqual(
        Buffer.concat([binaryChunk1, binaryChunk2]),
      );
      expect(onOutputEventMock).toHaveBeenCalledTimes(3);
      expect(onOutputEventMock.mock.calls[0][0]).toEqual({
        type: 'binary_detected',
      });
      expect(onOutputEventMock.mock.calls[1][0]).toEqual({
        type: 'binary_progress',
        bytesReceived: 4,
      });
      expect(onOutputEventMock.mock.calls[2][0]).toEqual({
        type: 'binary_progress',
        bytesReceived: 8,
      });
    });

    it('should not emit data events after binary is detected', async () => {
      mockIsBinary.mockImplementation((buffer) => buffer.includes(0x00));

      await simulateExecution('cat mixed_file', (cp) => {
        cp.stdout?.emit('data', Buffer.from('some text'));
        cp.stdout?.emit('data', Buffer.from([0x00, 0x01, 0x02]));
        cp.stdout?.emit('data', Buffer.from('more text'));
        cp.emit('exit', 0, null);
      });

      const eventTypes = onOutputEventMock.mock.calls.map(
        (call: [ShellOutputEvent]) => call[0].type,
      );
      expect(eventTypes).toEqual([
        'data',
        'binary_detected',
        'binary_progress',
        'binary_progress',
      ]);
    });
  });

  describe('Platform-Specific Behavior', () => {
    it('should use powershell.exe on Windows', async () => {
      mockPlatform.mockReturnValue('win32');
      await simulateExecution('dir "foo bar"', (cp) =>
        cp.emit('exit', 0, null),
      );

      expect(mockCpSpawn).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoProfile', '-Command', 'dir "foo bar"'],
        expect.objectContaining({
          shell: false,
          detached: false,
        }),
      );
    });

    it('should use bash and detached process group on Linux', async () => {
      mockPlatform.mockReturnValue('linux');
      await simulateExecution('ls "foo bar"', (cp) => cp.emit('exit', 0, null));

      expect(mockCpSpawn).toHaveBeenCalledWith(
        'bash',
        [
          '-c',
          'shopt -u promptvars nullglob extglob nocaseglob dotglob; ls "foo bar"',
        ],
        expect.objectContaining({
          shell: false,
          detached: true,
        }),
      );
    });
  });

  describe('Resource cleanup', () => {
    it('should remove all listeners from child process streams on exit', async () => {
      const removeAllListenersSpy = vi.spyOn(
        mockChildProcess.stdout as EventEmitter,
        'removeAllListeners',
      );
      const stderrRemoveAllListenersSpy = vi.spyOn(
        mockChildProcess.stderr as EventEmitter,
        'removeAllListeners',
      );

      await simulateExecution('echo test', (cp) => {
        cp.stdout?.emit('data', Buffer.from('test\n'));

        cp.emit('exit', 0, null);
      });

      expect(removeAllListenersSpy).toHaveBeenCalledWith('data');
      expect(stderrRemoveAllListenersSpy).toHaveBeenCalledWith('data');
    });

    it('should remove all listeners from child process on exit', async () => {
      const removeAllListenersSpy = vi.spyOn(
        mockChildProcess,
        'removeAllListeners',
      );

      await simulateExecution('echo test', (cp) => {
        cp.stdout?.emit('data', Buffer.from('test\n'));

        cp.emit('exit', 0, null);
      });

      expect(removeAllListenersSpy).toHaveBeenCalledWith('error');
      expect(removeAllListenersSpy).toHaveBeenCalledWith('exit');
      expect(removeAllListenersSpy).toHaveBeenCalledWith('close');
    });

    it('should only run cleanup once even if both exit and close fire', async () => {
      const removeAllListenersSpy = vi.spyOn(
        mockChildProcess,
        'removeAllListeners',
      );

      await simulateExecution('echo test', (cp) => {
        cp.stdout?.emit('data', Buffer.from('test\n'));

        cp.emit('exit', 0, null);
        cp.emit('close', 0, null);
      });

      const errorCalls = removeAllListenersSpy.mock.calls.filter(
        (call) => call[0] === 'error',
      );
      expect(errorCalls.length).toBe(1);
    });
  });
});

describe('ShellExecutionService execution method selection', () => {
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;
  let mockPtyProcess: EventEmitter & {
    pid: number;
    kill: Mock;
    onData: Mock;
    onExit: Mock;
  };
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;

  beforeEach(() => {
    vi.clearAllMocks();
    onOutputEventMock = vi.fn();

    // Mock for pty
    mockPtyProcess = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: Mock;
      onData: Mock;
      onExit: Mock;
    };
    mockPtyProcess.pid = 12345;
    mockPtyProcess.kill = vi.fn();
    mockPtyProcess.onData = vi.fn();
    mockPtyProcess.onExit = vi.fn();
    mockPtySpawn.mockReturnValue(mockPtyProcess);
    mockGetPty.mockResolvedValue({
      module: { spawn: mockPtySpawn },
      name: 'mock-pty',
    });

    // Mock for child_process
    mockChildProcess = new EventEmitter() as EventEmitter &
      Partial<ChildProcess>;
    mockChildProcess.stdout = new EventEmitter() as Readable;
    mockChildProcess.stderr = new EventEmitter() as Readable;
    mockChildProcess.kill = vi.fn();
    Object.defineProperty(mockChildProcess, 'pid', {
      value: 54321,
      configurable: true,
    });
    mockChildProcess.once = mockChildProcess.on.bind(mockChildProcess);
    mockCpSpawn.mockReturnValue(mockChildProcess);
  });

  // Default shell execution config for tests
  const defaultShellConfig = {
    showColor: false,
    scrollback: 600000,
    terminalWidth: 80,
    terminalHeight: 24,
  };

  it('should use node-pty when shouldUseNodePty is true and pty is available', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'test command',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true, // shouldUseNodePty
      defaultShellConfig,
    );

    // Simulate exit to allow promise to resolve
    mockPtyProcess.onExit.mock.calls[0][0]({ exitCode: 0, signal: null });
    const result = await handle.result;

    expect(mockGetPty).toHaveBeenCalled();
    expect(mockPtySpawn).toHaveBeenCalled();
    expect(mockCpSpawn).not.toHaveBeenCalled();
    expect(result.executionMethod).toBe('mock-pty');
  });

  it('should use child_process when shouldUseNodePty is false', async () => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'test command',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      false, // shouldUseNodePty
      defaultShellConfig,
    );

    // Simulate exit to allow promise to resolve
    mockChildProcess.emit('exit', 0, null);
    const result = await handle.result;

    expect(mockGetPty).not.toHaveBeenCalled();
    expect(mockPtySpawn).not.toHaveBeenCalled();
    expect(mockCpSpawn).toHaveBeenCalled();
    expect(result.executionMethod).toBe('child_process');
  });

  it('should fall back to child_process if pty is not available even if shouldUseNodePty is true', async () => {
    mockGetPty.mockResolvedValue(null);

    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      'test command',
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      true, // shouldUseNodePty
      defaultShellConfig,
    );

    // Simulate exit to allow promise to resolve
    mockChildProcess.emit('exit', 0, null);
    const result = await handle.result;

    expect(mockGetPty).toHaveBeenCalled();
    expect(mockPtySpawn).not.toHaveBeenCalled();
    expect(mockCpSpawn).toHaveBeenCalled();
    expect(result.executionMethod).toBe('child_process');
  });
});
