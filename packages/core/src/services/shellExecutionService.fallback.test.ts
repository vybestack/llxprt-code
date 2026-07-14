/**
 * @license
 * Copyright 2025 Google LLC
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
import type { Readable } from 'stream';
import { type ChildProcess } from 'child_process';
import type { ShellOutputEvent } from './shellExecutionService.js';
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

const stubProcessPlatform = (platform: NodeJS.Platform): void => {
  vi.stubGlobal('process', { ...process, env: process.env, platform });
};

describe('ShellExecutionService child_process fallback', () => {
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    stubProcessPlatform('linux');

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

  afterEach(() => {
    vi.unstubAllGlobals();
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
          stubProcessPlatform(platform as NodeJS.Platform);

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

      expect(result.rawOutput).toStrictEqual(
        Buffer.concat([binaryChunk1, binaryChunk2]),
      );
      expect(onOutputEventMock).toHaveBeenCalledTimes(3);
      expect(onOutputEventMock.mock.calls[0][0]).toStrictEqual({
        type: 'binary_detected',
      });
      expect(onOutputEventMock.mock.calls[1][0]).toStrictEqual({
        type: 'binary_progress',
        bytesReceived: 4,
      });
      expect(onOutputEventMock.mock.calls[2][0]).toStrictEqual({
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
      expect(eventTypes).toStrictEqual([
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
      stubProcessPlatform('win32');
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
