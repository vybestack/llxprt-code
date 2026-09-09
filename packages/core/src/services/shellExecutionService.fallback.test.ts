/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  mock,
  type Mock,
} from 'bun:test';
import EventEmitter from 'events';
import type { Readable } from 'stream';
import { type ChildProcess } from 'child_process';
import type {
  ShellExecutionConfig,
  ShellOutputEvent,
} from './shellExecutionService.js';
import { ShellExecutionService } from './shellExecutionService.js';

// Hoisted Mocks
const mockPtySpawn = vi.fn();
const mockCpSpawn = vi.fn();
const mockIsBinary = vi.fn();
const mockPlatform = vi.fn();
const mockGetPty = vi.fn();

// Top-level Mocks
void vi.mock('@lydell/node-pty', () => ({
  spawn: mockPtySpawn,
}));
// Captured before the vi.mock calls below execute (bun runs vi.mock in
// statement order). Bun resolves every file in one shared process and
// default-import bindings snapshot at load time, so the os factory below
// spreads the real module and stubs only platform/homedir: a leaked hollow
// os surface would break later files (shellProcessKill.test.ts needs
// os.tmpdir).
const actualOsModule = await import('os');
const realOsSurface = { ...actualOsModule.default };
const stubOsSurface = () => ({
  ...realOsSurface,
  platform: mockPlatform,
  homedir: () => '/tmp/test-home',
});
const actual = { ...(await import('child_process')) };
void vi.mock('child_process', () => ({
  ...actual,
  spawn: mockCpSpawn,
}));
void vi.mock('../utils/textUtils.js', () => ({
  isBinary: mockIsBinary,
}));
void vi.mock('os', () => ({ ...stubOsSurface(), default: stubOsSurface() }));
void vi.mock('../utils/getPty.js', () => ({
  getPty: mockGetPty,
}));

/**
 * Group pids that have received SIGKILL. Signal-0 liveness probes from the
 * abort group-reap confirmation (issue #3517) answer "alive" until the
 * group's SIGKILL is delivered, then ESRCH, mirroring a real process group
 * dying.
 */
const killedGroupPids = new Set<number>();
const mockProcessKill = vi
  .spyOn(process, 'kill')
  .mockImplementation((pid: number, signal?: NodeJS.Signals | number) => {
    if (signal === 0) {
      if (killedGroupPids.has(pid)) {
        throw Object.assign(new Error(`process group ${pid} not found`), {
          code: 'ESRCH',
        });
      }
      return true;
    }
    if (signal === 'SIGKILL') {
      killedGroupPids.add(pid);
    }
    return true;
  });

const stubProcessPlatform = (platform: NodeJS.Platform): void => {
  setGlobal('process', { ...process, env: process.env, platform });
};

describe('ShellExecutionService child_process fallback', () => {
  let mockChildProcess: EventEmitter & Partial<ChildProcess>;
  let onOutputEventMock: Mock<(event: ShellOutputEvent) => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    killedGroupPids.clear();
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
    restoreGlobals();
  });

  // Bun runs every test file in this invocation in one shared process. The
  // module-level process.kill spy and the vi.mock module replacements leak
  // into later files, so this file leaves them behaviorally real: the spy is
  // restored, the leaked platform stub passes through to the real platform,
  // and child_process is re-registered with the real spawn for live named
  // bindings resolved after this point (default-import bindings snapshot at
  // load time, which is why the os factory itself must stay passthrough-real).
  afterAll(() => {
    mockProcessKill.mockRestore();
    mockPlatform.mockReset();
    mockPlatform.mockImplementation(() => realOsSurface.platform());
    const realChildProcess = () => ({ ...actual, spawn: actual.spawn });
    void mock.module('child_process', realChildProcess);
    void mock.module('node:child_process', realChildProcess);
  });

  // Default shell execution config for tests
  const defaultShellConfig: ShellExecutionConfig = {
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
    shellConfig = defaultShellConfig,
  ) => {
    const abortController = new AbortController();
    const handle = await ShellExecutionService.execute(
      command,
      '/test/dir',
      onOutputEventMock,
      abortController.signal,
      shouldUseNodePty,
      shellConfig,
    );

    await new Promise((resolve) => setImmediate(resolve));
    simulation(mockChildProcess, abortController);
    const result = await handle.result;
    return { result, handle, abortController };
  };

  const emitExpectedAbortExit = (
    childProcess: typeof mockChildProcess,
    expectedExit: { readonly signal?: NodeJS.Signals; readonly code?: number },
  ): void => {
    if (expectedExit.signal)
      childProcess.emit('exit', null, expectedExit.signal);
    if (typeof expectedExit.code === 'number') {
      childProcess.emit('exit', expectedExit.code, null);
    }
  };

  const expectedAbortMechanism = (
    platform: string,
    expectedSignal: string | undefined,
    expectedCommand: string | undefined,
  ): string | undefined =>
    platform === 'linux' ? expectedSignal : expectedCommand;

  const childProcessGroupPid = (): number => {
    if (mockChildProcess.pid === undefined) {
      throw new Error('Expected mock child process pid');
    }
    return -mockChildProcess.pid;
  };

  const linuxKillMatches = (expectedSignal: string | undefined): boolean =>
    mockProcessKill.mock.calls.some(
      (call) =>
        call[0] === childProcessGroupPid() && call[1] === expectedSignal,
    );

  const windowsKillMatches = (expectedCommand: string | undefined): boolean =>
    mockCpSpawn.mock.calls.some(
      (call) =>
        call[0] === expectedCommand &&
        JSON.stringify(call[1]) ===
          JSON.stringify(['/pid', String(mockChildProcess.pid), '/f', '/t']),
    );

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

    it('emits decoder flush output for an incomplete final sequence', async () => {
      const { result } = await simulateExecution('partial-output', (cp) => {
        cp.stdout?.emit('data', Buffer.from([0xe2, 0x82]));
        cp.emit('exit', 0, null);
      });

      expect(result.output).toBe('\uFFFD');
      expect(onOutputEventMock).toHaveBeenCalledWith({
        type: 'data',
        chunk: '\uFFFD',
      });
    });

    it('should handle commands with no output', async () => {
      const { result } = await simulateExecution('touch file', (cp) => {
        cp.emit('exit', 0, null);
      });

      expect(result.output).toBe('');
      expect(onOutputEventMock).not.toHaveBeenCalled();
    });

    it('bounds retained stdout with one accurate omission notice', async () => {
      const retentionBytes = 1024;
      const firstChunk = 'a'.repeat(retentionBytes);
      const finalMarker = 'FINAL_MARKER';

      const { result } = await simulateExecution(
        'large-output',
        (cp) => {
          cp.stdout?.emit('data', Buffer.from(firstChunk));
          cp.stdout?.emit('data', Buffer.from('b'.repeat(retentionBytes)));
          cp.stdout?.emit('data', Buffer.from(finalMarker));
          cp.emit('exit', 0, null);
        },
        true,
        { ...defaultShellConfig, outputRetentionMaxBytes: retentionBytes },
      );

      expect(result.rawOutput.length).toBeLessThanOrEqual(retentionBytes);
      expect(result.output.startsWith('a'.repeat(20))).toBe(true);
      expect(result.output.endsWith(finalMarker)).toBe(true);
      expect(result.output.match(/LLXPRT output truncated/g)).toHaveLength(1);
      expect(result.outputTruncation).toStrictEqual({
        observedBytes: retentionBytes * 2 + finalMarker.length,
        retainedBytes: retentionBytes,
        omittedBytes: retentionBytes + finalMarker.length,
        truncated: true,
        budgetBytes: retentionBytes,
      });
    });
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
              emitExpectedAbortExit(cp, expectedExit);
            },
          );

          expect(result.aborted).toBe(true);

          // Verify platform-specific abort behavior
          expect(
            expectedAbortMechanism(platform, expectedSignal, expectedCommand),
          ).toBeDefined();

          // Exactly one platform-specific kill method should match.
          expect(
            platformKillMatch(
              platform,
              linuxKillMatches(expectedSignal),
              windowsKillMatches(expectedCommand),
            ),
          ).toBe(true);
        });
      },
    );

    it('should gracefully attempt SIGKILL on linux if SIGTERM fails', async () => {
      mockPlatform.mockReturnValue('linux');
      vi.useFakeTimers();
      try {
        // Don't await the result inside the simulation block for this specific
        // test. We need to control the timeline manually.
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
        await advanceTimersByTimeAsync(250);

        // Check the second kill signal
        expect(mockProcessKill).toHaveBeenCalledWith(
          -mockChildProcess.pid!,
          'SIGKILL',
        );

        // Finally, simulate the process exiting and await the result
        mockChildProcess.emit('exit', null, 'SIGKILL');
        const result = await handle.result;

        expect(result.aborted).toBe(true);
        expect(result.signal).toBe(9);
        // The individual kill calls were already asserted above. Signal-0
        // liveness probes from the group-reap confirmation (issue #3517) are
        // not signal deliveries, so count real signals only.
        const deliveredSignals = mockProcessKill.mock.calls.filter(
          (call) => call[1] !== 0,
        );
        expect(deliveredSignals).toHaveLength(2);
      } finally {
        // A failing or stuck body must not leave fake timers installed for
        // the rest of the file: every later await (including Bun's own
        // per-test timeout, which is itself a faked timer) would then hang
        // until the per-file budget — the twice-identical 300s timeout seen
        // under run-bun-tests.ts.
        vi.useRealTimers();
      }
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
        ['-NoProfile', '-Command', expect.stringContaining('dir "foo bar"')],
        expect.objectContaining({
          shell: false,
          detached: false,
          windowsHide: true,
        }),
      );

      // Pin the full composed command through the service so the exit-code
      // wiring is proven on non-Windows dev machines.
      expect(mockCpSpawn).toHaveBeenCalledWith(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          '$global:LASTEXITCODE = 0;\ndir "foo bar"\nif ($?) { exit 0 }\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\nexit 1',
        ],
        expect.anything(),
      );
    });

    it('decodes PowerShell CLIXML stderr on Windows', async () => {
      mockPlatform.mockReturnValue('win32');
      stubProcessPlatform('win32');
      const clixml =
        '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">kaboom_x000D__x000A_</S></Objs>';

      const { result } = await simulateExecution('Write-Error kaboom', (cp) => {
        cp.stderr?.emit('data', Buffer.from(clixml));
        cp.emit('exit', 1, null);
      });

      expect(result.output).toBe('kaboom');
      expect(result.output).not.toContain('#< CLIXML');
    });

    it('decodes retained CLIXML and reports truncation once', async () => {
      mockPlatform.mockReturnValue('win32');
      stubProcessPlatform('win32');
      const clixml =
        '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">kaboom_x000D__x000A_</S></Objs>';

      const { result } = await simulateExecution(
        'Write-Error kaboom',
        (cp) => {
          cp.stdout?.emit('data', Buffer.from('x'.repeat(1600)));
          cp.stderr?.emit('data', Buffer.from(clixml));
          cp.emit('exit', 1, null);
        },
        true,
        { ...defaultShellConfig, outputRetentionMaxBytes: 1024 },
      );

      expect(result.output).toContain('kaboom');
      expect(result.output).not.toContain('#< CLIXML');
      expect(result.output.match(/LLXPRT output truncated/g)).toHaveLength(1);
      expect(result.outputTruncation?.truncated).toBe(true);
      expect(result.outputTruncation?.retainedBytes).toBe(1024);
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

  describe('Windows console isolation (Issue #2548)', () => {
    it('should include windowsHide=true in spawn options on Windows', async () => {
      mockPlatform.mockReturnValue('win32');
      stubProcessPlatform('win32');
      await simulateExecution('echo hello', (cp) => cp.emit('exit', 0, null));

      expect(mockCpSpawn).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoProfile', '-Command', expect.stringContaining('echo hello')],
        expect.objectContaining({
          windowsHide: true,
        }),
      );
    });

    it('should still capture stdout output when windowsHide=true on Windows', async () => {
      mockPlatform.mockReturnValue('win32');
      stubProcessPlatform('win32');

      const { result } = await simulateExecution('echo hello', (cp) => {
        cp.stdout?.emit('data', Buffer.from('hello world output'));
        cp.emit('exit', 0, null);
      });

      expect(result.output).toBe('hello world output');
      expect(onOutputEventMock).toHaveBeenCalledWith({
        type: 'data',
        chunk: 'hello world output',
      });
    });

    it('should not set windowsHide on non-Windows platforms', async () => {
      mockPlatform.mockReturnValue('linux');
      await simulateExecution('echo hello', (cp) => cp.emit('exit', 0, null));

      const spawnCall = mockCpSpawn.mock.calls[0];
      const spawnOptions = spawnCall[2];
      expect(spawnOptions.windowsHide).toBeUndefined();
    });
  });
});

function platformKillMatch(
  platform: string,
  linux: boolean,
  windows: boolean,
): boolean {
  return platform === 'linux' ? linux : windows;
}
