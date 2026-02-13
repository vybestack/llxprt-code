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

const mockShellExecutionService = vi.hoisted(() => vi.fn());
const mockOsHomedir = vi.hoisted(() => vi.fn(() => '/home/user'));
const mockOsTmpdir = vi.hoisted(() => vi.fn(() => '/tmp'));
const mockOsPlatform = vi.hoisted(() => vi.fn(() => 'linux'));
vi.mock('../services/shellExecutionService.js', () => ({
  ShellExecutionService: {
    execute: mockShellExecutionService,
    isActivePty: vi.fn().mockReturnValue(true),
    getLastActivePtyId: vi.fn().mockReturnValue(null),
  },
}));
vi.mock('fs');
vi.mock('os', () => ({
  default: {
    homedir: mockOsHomedir,
    tmpdir: mockOsTmpdir,
    platform: mockOsPlatform,
    hostname: vi.fn(() => 'mock-host'),
    userInfo: vi.fn(() => ({ username: 'mock-user' })),
    EOL: '\n',
  },
  homedir: mockOsHomedir,
  tmpdir: mockOsTmpdir,
  platform: mockOsPlatform,
  hostname: vi.fn(() => 'mock-host'),
  userInfo: vi.fn(() => ({ username: 'mock-user' })),
  EOL: '\n',
}));
vi.mock('crypto');

import { isCommandAllowed } from '../utils/shell-utils.js';
import { ShellTool } from './shell.js';
import { type Config } from '../config/config.js';
import {
  type ShellExecutionResult,
  type ShellOutputEvent,
} from '../services/shellExecutionService.js';
import * as fs from 'fs';
import * as os from 'os';
import { EOL } from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { ToolErrorType } from './tool-error.js';
import { ToolConfirmationOutcome } from './tools.js';
import { OUTPUT_UPDATE_INTERVAL_MS } from './shell.js';
import { createMockWorkspaceContext } from '../test-utils/mockWorkspaceContext.js';
// Mock the summarizer module
vi.mock('../utils/summarizer.js', () => ({
  summarizeToolOutput: vi.fn(),
}));

import * as summarizer from '../utils/summarizer.js';

const originalComSpec = process.env['ComSpec'];
const itWindowsOnly = process.platform === 'win32' ? it : it.skip;

describe('ShellTool', () => {
  let shellTool: ShellTool;
  let mockConfig: Config;
  let mockShellOutputCallback: (event: ShellOutputEvent) => void;
  let resolveExecutionPromise: (result: ShellExecutionResult) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      getCoreTools: vi.fn().mockReturnValue([]),
      getExcludeTools: vi.fn().mockReturnValue([]),
      getDebugMode: vi.fn().mockReturnValue(false),
      getTargetDir: vi.fn().mockReturnValue('/test/dir'),
      getSummarizeToolOutputConfig: vi.fn().mockReturnValue(undefined),
      getWorkspaceContext: vi
        .fn()
        .mockReturnValue(createMockWorkspaceContext('.')),
      getGeminiClient: vi.fn(),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getShouldUseNodePtyShell: vi.fn().mockReturnValue(false),
      getAllowPtyThemeOverride: vi.fn().mockReturnValue(false),
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        providerManager: {
          getServerToolsProvider: vi.fn().mockReturnValue({
            name: 'gemini',
            getServerTools: vi.fn().mockReturnValue([]),
            invokeServerTool: vi.fn(),
          }),
        },
      }),
      isInteractive: vi.fn().mockReturnValue(true),
      getShellExecutionConfig: vi.fn().mockReturnValue({
        showColor: false,
        scrollback: 600000,
      }),
      getPtyTerminalWidth: vi.fn().mockReturnValue(80),
      getPtyTerminalHeight: vi.fn().mockReturnValue(24),
    } as unknown as Config;

    shellTool = new ShellTool(mockConfig);

    mockOsPlatform.mockReturnValue('linux');
    mockOsTmpdir.mockReturnValue('/tmp');
    (vi.mocked(crypto.randomBytes) as Mock).mockReturnValue(
      Buffer.from('abcdef', 'hex'),
    );

    // Capture the output callback to simulate streaming events from the service
    mockShellExecutionService.mockImplementation((_cmd, _cwd, callback) => {
      mockShellOutputCallback = callback;
      return {
        pid: 12345,
        result: new Promise((resolve) => {
          resolveExecutionPromise = resolve;
        }),
      };
    });
  });

  afterEach(() => {
    if (originalComSpec === undefined) {
      delete process.env['ComSpec'];
    } else {
      process.env['ComSpec'] = originalComSpec;
    }
  });

  describe('isCommandAllowed', () => {
    it('should allow a command if no restrictions are provided', () => {
      (mockConfig.getCoreTools as Mock).mockReturnValue(undefined);
      (mockConfig.getExcludeTools as Mock).mockReturnValue(undefined);
      expect(isCommandAllowed('ls -l', mockConfig).allowed).toBe(true);
    });

    it('should block a command with command substitution using $() when shell-replacement is none', () => {
      // Configure to block all substitution
      (mockConfig.getShellReplacement as Mock) = vi
        .fn()
        .mockReturnValue('none');
      expect(isCommandAllowed('echo $(rm -rf /)', mockConfig).allowed).toBe(
        false,
      );
    });
  });

  describe('build', () => {
    it('should return an invocation for a valid command', () => {
      const invocation = shellTool.build({ command: 'ls -l' });
      expect(invocation).toBeDefined();
    });

    it('should throw an error for an empty command', () => {
      expect(() => shellTool.build({ command: ' ' })).toThrow(
        'Command cannot be empty.',
      );
    });

    it('should accept a multi-segment relative path within workspace', () => {
      const workspaceContext = createMockWorkspaceContext('/test/dir');
      vi.mocked(workspaceContext.isPathWithinWorkspace).mockReturnValue(true);
      (mockConfig.getWorkspaceContext as Mock).mockReturnValue(
        workspaceContext,
      );

      expect(() =>
        shellTool.build({ command: 'ls', directory: 'rel/path' }),
      ).not.toThrow();
    });

    it('should allow absolute directory within workspace', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const workspaceContext = createMockWorkspaceContext('/test/dir');
      vi.mocked(workspaceContext.isPathWithinWorkspace).mockReturnValue(true);
      (mockConfig.getWorkspaceContext as Mock).mockReturnValue(
        workspaceContext,
      );

      expect(() =>
        shellTool.build({ command: 'ls', directory: '/test/dir/subdir' }),
      ).not.toThrow();
    });
  });

  describe('execute', () => {
    const mockAbortSignal = new AbortController().signal;

    const resolveShellExecution = (
      result: Partial<ShellExecutionResult> = {},
    ) => {
      const fullResult: ShellExecutionResult = {
        rawOutput: Buffer.from(result.output || ''),
        output: 'Success',
        exitCode: 0,
        signal: null,
        error: null,
        aborted: false,
        pid: 12345,
        executionMethod: 'child_process',
        ...result,
      };
      resolveExecutionPromise(fullResult);
    };

    it('should wrap command on linux and parse pgrep output', async () => {
      const servicePid = 54321;
      const bgPid = 54322;
      const invocation = shellTool.build({ command: 'my-command &' });

      // Mock fs.existsSync to return true before execution
      vi.mocked(fs.existsSync).mockReturnValue(true);
      // Mock fs.readFileSync to return the PIDs
      vi.mocked(fs.readFileSync).mockReturnValue(
        `${servicePid}${EOL}${bgPid}${EOL}`,
      );

      const promise = invocation.execute(mockAbortSignal);
      resolveShellExecution({ pid: servicePid });

      const result = await promise;

      const tmpFile = path.join(os.tmpdir(), 'shell_pgrep_abcdef.tmp');
      const wrappedCommand = `{ my-command & }; __code=$?; pgrep -g 0 >${tmpFile} 2>&1; exit $__code;`;
      expect(mockShellExecutionService).toHaveBeenCalledWith(
        wrappedCommand,
        expect.any(String),
        expect.any(Function),
        expect.any(AbortSignal),
        false,
        expect.objectContaining({
          terminalWidth: 80,
          terminalHeight: 24,
        }),
      );
      // Check that it contains background PIDs but not the service PID
      const backgroundLine = result.llmContent
        .split('\n')
        .find((line) => line.startsWith('Background PIDs:'));
      expect(backgroundLine).toBeDefined();
      const backgroundLineValue = backgroundLine ?? '';
      expect(backgroundLineValue).toContain(bgPid.toString());
      expect(backgroundLineValue).not.toContain(servicePid.toString());
      expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalledWith(tmpFile);
    });

    it('should use the provided directory as cwd', async () => {
      (mockConfig.getWorkspaceContext as Mock).mockReturnValue(
        createMockWorkspaceContext('/test/dir'),
      );
      const invocation = shellTool.build({
        command: 'ls',
        directory: '/test/dir/subdir',
      });
      const promise = invocation.execute(mockAbortSignal);
      resolveShellExecution();
      await promise;

      const tmpFile = path.join(os.tmpdir(), 'shell_pgrep_abcdef.tmp');
      const isWindows = os.platform() === 'win32';
      const expectedCommand = isWindows
        ? 'ls'
        : `{ ls; }; __code=$?; pgrep -g 0 >${tmpFile} 2>&1; exit $__code;`;
      const expectedCwd = path.resolve('/test/dir', '/test/dir/subdir');
      expect(mockShellExecutionService).toHaveBeenCalledWith(
        expectedCommand,
        expectedCwd,
        expect.any(Function),
        expect.any(AbortSignal),
        false,
        expect.objectContaining({
          terminalWidth: 80,
          terminalHeight: 24,
        }),
      );
    });

    itWindowsOnly(
      'should not wrap command on windows',
      async () => {
        vi.mocked(os.platform).mockReturnValue('win32');
        const invocation = shellTool.build({ command: 'dir' });
        const promise = invocation.execute(mockAbortSignal);
        resolveShellExecution({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        });
        await promise;
        const expectedCwd = path.resolve('/test/dir', '');
        // eslint-disable-next-line vitest/no-standalone-expect -- platform-conditional test
        expect(mockShellExecutionService).toHaveBeenCalledWith(
          'dir',
          expectedCwd,
          expect.any(Function),
          expect.any(AbortSignal),
          false,
          undefined,
          undefined,
        );
      },
      20000,
    );

    it('should format error messages correctly', async () => {
      const error = new Error('original command error');
      const invocation = shellTool.build({ command: 'user-command' });

      // Mock fs.existsSync to return false for pgrep file (no background processes)
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const promise = invocation.execute(mockAbortSignal);
      resolveShellExecution({
        error,
        exitCode: 1,
        output: 'err',
        rawOutput: Buffer.from('err'),
        signal: null,
        aborted: false,
        pid: 12345,
        executionMethod: 'child_process',
      });

      const result = await promise;
      // Check that the original command error is shown, not the wrapped command
      expect(result.llmContent).toContain('Error: original command error');
      expect(result.llmContent).not.toContain('pgrep');
    });

    it('should return a SHELL_EXECUTE_ERROR for a command failure', async () => {
      const error = new Error('command failed');
      const invocation = shellTool.build({ command: 'user-command' });
      const promise = invocation.execute(mockAbortSignal);
      resolveShellExecution({
        error,
        exitCode: 1,
      });

      const result = await promise;

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.SHELL_EXECUTE_ERROR);
      expect(result.error?.message).toBe('command failed');
    });

    it('should throw an error for invalid parameters', () => {
      expect(() => shellTool.build({ command: '' })).toThrow(
        'Command cannot be empty.',
      );
    });

    it('should throw an error for invalid directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() =>
        shellTool.build({ command: 'ls', directory: 'nonexistent' }),
      ).toThrow(
        `Directory 'nonexistent' is not a registered workspace directory`,
      );
    });

    it('should summarize output when configured', async () => {
      (mockConfig.getSummarizeToolOutputConfig as Mock).mockReturnValue({
        [shellTool.name]: { tokenBudget: 1000 },
      });
      vi.mocked(summarizer.summarizeToolOutput).mockResolvedValue(
        'summarized output',
      );

      const invocation = shellTool.build({ command: 'ls' });
      const promise = invocation.execute(mockAbortSignal);
      resolveExecutionPromise({
        output: 'long output',
        stdout: 'long output',
        stderr: '',
        rawOutput: Buffer.from('long output'),
        exitCode: 0,
        signal: null,
        error: null,
        aborted: false,
        pid: 12345,
        executionMethod: 'child_process',
      });

      const result = await promise;

      expect(summarizer.summarizeToolOutput).toHaveBeenCalledWith(
        expect.any(String),
        mockConfig.getGeminiClient(),
        mockAbortSignal,
        1000,
      );
      expect(result.llmContent).toBe('summarized output');
      expect(result.returnDisplay).toBe('long output');
    });

    it('should clean up the temp file on synchronous execution error', async () => {
      const error = new Error('sync spawn error');
      mockShellExecutionService.mockImplementation(() => {
        throw error;
      });
      vi.mocked(fs.existsSync).mockReturnValue(true); // Pretend the file exists

      const invocation = shellTool.build({ command: 'a-command' });
      await expect(invocation.execute(mockAbortSignal)).rejects.toThrow(error);

      const tmpFile = path.join(os.tmpdir(), 'shell_pgrep_abcdef.tmp');
      expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalledWith(tmpFile);
    });

    describe('timeout_seconds handling', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('uses default timeout when timeout_seconds is omitted', async () => {
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        mockConfig.getEphemeralSettings.mockReturnValue({
          'shell-default-timeout-seconds': 2,
          'shell-max-timeout-seconds': 5,
        });

        const invocation = shellTool.build({ command: 'ls' });
        const promise = invocation.execute(mockAbortSignal);
        resolveShellExecution({
          output: '',
          stdout: '',
          stderr: '',
          rawOutput: Buffer.from(''),
        });
        await promise;

        // 2 seconds = 2000ms
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
        setTimeoutSpy.mockRestore();
      });

      it('clamps timeout_seconds to the maximum setting', async () => {
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        mockConfig.getEphemeralSettings.mockReturnValue({
          'shell-default-timeout-seconds': 1,
          'shell-max-timeout-seconds': 2,
        });

        const invocation = shellTool.build({
          command: 'ls',
          timeout_seconds: 5,
        });
        const promise = invocation.execute(mockAbortSignal);
        resolveShellExecution({
          output: '',
          stdout: '',
          stderr: '',
          rawOutput: Buffer.from(''),
        });
        await promise;

        // Clamped to 2 seconds = 2000ms
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
        setTimeoutSpy.mockRestore();
      });

      it('skips the timeout when timeout_seconds is -1', async () => {
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        mockConfig.getEphemeralSettings.mockReturnValue({
          'shell-default-timeout-seconds': 1,
          'shell-max-timeout-seconds': 2,
        });

        const invocation = shellTool.build({
          command: 'ls',
          timeout_seconds: -1,
        });
        const promise = invocation.execute(mockAbortSignal);
        resolveShellExecution({
          output: '',
          stdout: '',
          stderr: '',
          rawOutput: Buffer.from(''),
        });
        await promise;

        expect(setTimeoutSpy).not.toHaveBeenCalled();
        setTimeoutSpy.mockRestore();
      });

      it('returns a TIMEOUT error with partial output', async () => {
        vi.useFakeTimers();
        const invocation = shellTool.build({
          command: 'long-running',
          timeout_seconds: 0.05, // 50ms
        });
        const promise = invocation.execute(mockAbortSignal);

        await vi.advanceTimersByTimeAsync(60);
        resolveShellExecution({
          aborted: true,
          output: 'partial output',
          stdout: 'partial output',
          stderr: '',
          rawOutput: Buffer.from('partial output'),
          exitCode: null,
          signal: null,
          error: null,
        });

        const result = await promise;

        expect(result.error?.type).toBe(ToolErrorType.TIMEOUT);
        expect(result.llmContent).toContain('timeout_seconds');
        expect(result.llmContent).toContain('partial output');
      });

      it('returns EXECUTION_FAILED for user aborts', async () => {
        const abortController = new AbortController();
        abortController.abort();
        const invocation = shellTool.build({
          command: 'ls',
          timeout_seconds: 1,
        });

        const result = await invocation.execute(abortController.signal);

        expect(result.error?.type).toBe(ToolErrorType.EXECUTION_FAILED);
        expect(result.error?.type).not.toBe(ToolErrorType.TIMEOUT);
      });

      it('timeout does not start until execute() is called (approval time not counted)', async () => {
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        mockConfig.getEphemeralSettings.mockReturnValue({
          'shell-default-timeout-seconds': 1,
          'shell-max-timeout-seconds': 5,
        });

        const invocation = shellTool.build({
          command: 'some-command',
          timeout_seconds: 1,
        });

        const setTimeoutCountBefore = setTimeoutSpy.mock.calls.length;
        await invocation.shouldConfirmExecute(new AbortController().signal);

        expect(setTimeoutSpy.mock.calls.length).toBe(setTimeoutCountBefore);

        const promise = invocation.execute(mockAbortSignal);

        expect(setTimeoutSpy.mock.calls.length).toBeGreaterThan(
          setTimeoutCountBefore,
        );

        const lastCall =
          setTimeoutSpy.mock.calls[setTimeoutSpy.mock.calls.length - 1];
        expect(lastCall[1]).toBe(1000);

        resolveShellExecution({
          output: 'success',
          stdout: 'success',
          stderr: '',
          rawOutput: Buffer.from('success'),
        });

        const result = await promise;
        expect(result.error).toBeUndefined();

        setTimeoutSpy.mockRestore();
      });
    });

    describe('Streaming to `updateOutput`', () => {
      let updateOutputMock: Mock;
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        updateOutputMock = vi.fn();
      });
      afterEach(() => {
        vi.useRealTimers();
      });

      it('should update immediately on every data event', async () => {
        // Data events represent full screen state (AnsiOutput in PTY mode or
        // cumulative string in child_process mode), so each one is displayed
        // immediately without throttling.
        const invocation = shellTool.build({ command: 'stream' });
        const promise = invocation.execute(mockAbortSignal, updateOutputMock);

        mockShellOutputCallback({
          type: 'data',
          chunk: 'hello ',
        });
        expect(updateOutputMock).toHaveBeenCalledExactlyOnceWith('hello ');

        // Second chunk also updates immediately (no throttle for data events).
        mockShellOutputCallback({
          type: 'data',
          chunk: 'world',
        });
        expect(updateOutputMock).toHaveBeenCalledTimes(2);
        expect(updateOutputMock).toHaveBeenLastCalledWith('world');

        // Third chunk also updates immediately.
        mockShellOutputCallback({
          type: 'data',
          chunk: '!',
        });
        expect(updateOutputMock).toHaveBeenCalledTimes(3);
        expect(updateOutputMock).toHaveBeenLastCalledWith('!');

        resolveExecutionPromise({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        });
        await promise;
      });

      it('should immediately show binary detection message and throttle progress', async () => {
        const invocation = shellTool.build({ command: 'cat img' });
        const promise = invocation.execute(mockAbortSignal, updateOutputMock);

        mockShellOutputCallback({ type: 'binary_detected' });
        expect(updateOutputMock).toHaveBeenCalledOnce();
        expect(updateOutputMock).toHaveBeenCalledWith(
          '[Binary output detected. Halting stream...]',
        );

        mockShellOutputCallback({
          type: 'binary_progress',
          bytesReceived: 1024,
        });
        // Still only called once because we're throttling
        expect(updateOutputMock).toHaveBeenCalledOnce();

        // Advance time past the throttle interval.
        await vi.advanceTimersByTimeAsync(OUTPUT_UPDATE_INTERVAL_MS + 1);

        // Send a SECOND progress event. This one will trigger the flush.
        mockShellOutputCallback({
          type: 'binary_progress',
          bytesReceived: 2048,
        });

        // Still only called once because we're throttling
        expect(updateOutputMock).toHaveBeenCalledTimes(2);

        // Now it should be called a second time with the latest progress.
        expect(updateOutputMock).toHaveBeenCalledTimes(2);
        // Second call should be the latest progress (2048 bytes = 2.0 KB)
        expect(updateOutputMock).toHaveBeenNthCalledWith(
          2,
          '[Receiving binary output... 2.0 KB received]',
        );

        resolveExecutionPromise({
          rawOutput: Buffer.from(''),
          output: '',
          exitCode: 0,
          signal: null,
          error: null,
          aborted: false,
          pid: 12345,
          executionMethod: 'child_process',
        });
        await promise;
      });
    });
  });

  describe('shouldConfirmExecute', () => {
    it('should request confirmation for a new command and allowlist it on "Always"', async () => {
      const params = { command: 'npm install' };
      const invocation = shellTool.build(params);
      const confirmation = await invocation.shouldConfirmExecute(
        new AbortController().signal,
      );

      expect(confirmation).not.toBe(false);
      expect(confirmation && confirmation.type).toBe('exec');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (confirmation as any).onConfirm(
        ToolConfirmationOutcome.ProceedAlways,
      );

      // Should now be allowlisted
      const secondInvocation = shellTool.build({ command: 'npm test' });
      const secondConfirmation = await secondInvocation.shouldConfirmExecute(
        new AbortController().signal,
      );
      expect(secondConfirmation).toBe(false);
    });

    it('should throw an error if validation fails', () => {
      expect(() => shellTool.build({ command: '' })).toThrow();
    });

    describe('in non-interactive mode', () => {
      beforeEach(() => {
        (mockConfig.isInteractive as Mock).mockReturnValue(false);
        (mockConfig as Record<string, unknown>).getAllowedTools = vi
          .fn()
          .mockReturnValue([]);
        (mockConfig as Record<string, unknown>).getApprovalMode = vi
          .fn()
          .mockReturnValue('strict');
      });

      it('should not throw an error or block for an allowed command', async () => {
        (
          (mockConfig as Record<string, unknown>).getAllowedTools as Mock
        ).mockReturnValue(['ShellTool(wc)']);
        const invocation = shellTool.build({ command: 'wc -l foo.txt' });
        const confirmation = await invocation.shouldConfirmExecute(
          new AbortController().signal,
        );
        expect(confirmation).toBe(false);
      });

      it('should not throw an error or block for an allowed command with arguments', async () => {
        (
          (mockConfig as Record<string, unknown>).getAllowedTools as Mock
        ).mockReturnValue(['ShellTool(wc -l)']);
        const invocation = shellTool.build({ command: 'wc -l foo.txt' });
        const confirmation = await invocation.shouldConfirmExecute(
          new AbortController().signal,
        );
        expect(confirmation).toBe(false);
      });

      it('should throw an error for command that is not allowed', async () => {
        (
          (mockConfig as Record<string, unknown>).getAllowedTools as Mock
        ).mockReturnValue(['ShellTool(wc -l)']);
        const invocation = shellTool.build({ command: 'madeupcommand' });
        await expect(
          invocation.shouldConfirmExecute(new AbortController().signal),
        ).rejects.toThrow('madeupcommand');
      });

      it('should throw an error for a command that is a prefix of an allowed command', async () => {
        (
          (mockConfig as Record<string, unknown>).getAllowedTools as Mock
        ).mockReturnValue(['ShellTool(wc -l)']);
        const invocation = shellTool.build({ command: 'wc' });
        await expect(
          invocation.shouldConfirmExecute(new AbortController().signal),
        ).rejects.toThrow('wc');
      });

      it('should require all segments of a chained command to be allowlisted', async () => {
        (mockConfig.getAllowedTools as Mock).mockReturnValue([
          'ShellTool(echo)',
        ]);
        const invocation = shellTool.build({ command: 'echo "foo" && ls -l' });
        await expect(
          invocation.shouldConfirmExecute(new AbortController().signal),
        ).rejects.toThrow(
          'Command "echo "foo" && ls -l" is not in the list of allowed tools for non-interactive mode.',
        );
      });
    });
  });

  describe('getDescription', () => {
    it('should return the windows description when on windows', () => {
      mockOsPlatform.mockReturnValue('win32');
      const shellTool = new ShellTool(mockConfig);
      expect(shellTool.description).toMatchSnapshot();
    });

    it('should return the non-windows description when not on windows', () => {
      mockOsPlatform.mockReturnValue('linux');
      const shellTool = new ShellTool(mockConfig);
      expect(shellTool.description).toMatchSnapshot();
    });
  });
});

describe('build', () => {
  it('should return an invocation for valid directory', () => {
    const config = {
      getCoreTools: () => undefined,
      getExcludeTools: () => undefined,
      getTargetDir: () => '/root',
      getWorkspaceContext: () =>
        createMockWorkspaceContext('/root', ['/users/test']),
    } as unknown as Config;
    const shellTool = new ShellTool(config);
    const invocation = shellTool.build({
      command: 'ls',
      directory: 'test',
    });
    expect(invocation).toBeDefined();
  });

  it('should throw an error for directory outside workspace', () => {
    const workspaceContext = createMockWorkspaceContext('/root', [
      '/users/test',
    ]);
    vi.mocked(workspaceContext.isPathWithinWorkspace).mockReturnValue(false);
    const config = {
      getCoreTools: () => undefined,
      getExcludeTools: () => undefined,
      getTargetDir: () => '/root',
      getWorkspaceContext: () => workspaceContext,
    } as unknown as Config;
    const shellTool = new ShellTool(config);
    expect(() =>
      shellTool.build({
        command: 'ls',
        directory: 'outside',
      }),
    ).toThrow('is not a registered workspace directory');
  });
});

describe('Shell Tool Filtering Behavior', () => {
  let shellTool: ShellTool;
  let mockConfig:
    | {
        getEphemeralSettings: Mock;
        getTargetDir: Mock;
      }
    | undefined;

  beforeEach(() => {
    mockConfig = {
      getEphemeralSettings: vi.fn().mockReturnValue({
        'tool-output-max-tokens': 1000,
        'tool-output-truncate-mode': 'warn',
      }),
      getTargetDir: vi.fn().mockReturnValue('/test/dir'),
      getExcludeTools: vi.fn().mockReturnValue([]),
      getCoreTools: vi.fn().mockReturnValue([]),
      getShouldUseNodePtyShell: vi.fn().mockReturnValue(false),
      getAllowPtyThemeOverride: vi.fn().mockReturnValue(false),
      getDebugMode: vi.fn().mockReturnValue(false),
      getSummarizeToolOutputConfig: vi.fn().mockReturnValue(null),
      getContentGeneratorConfig: vi.fn().mockReturnValue(null),
      getGeminiClient: vi.fn().mockReturnValue(null),
      getWorkspaceContext: vi.fn().mockReturnValue({
        getWorkspaceDirectories: () => ['/test/dir'],
      }),
      getShellExecutionConfig: vi.fn().mockReturnValue({
        showColor: false,
        scrollback: 600000,
      }),
      getPtyTerminalWidth: vi.fn().mockReturnValue(80),
      getPtyTerminalHeight: vi.fn().mockReturnValue(24),
    } as unknown as Config;

    shellTool = new ShellTool(mockConfig as unknown as Config);
  });

  describe('head_lines filtering', () => {
    it('should limit output to specified number of lines from the beginning', async () => {
      // Arrange: Create shell output with many lines
      const longOutput = Array.from(
        { length: 100 },
        (_, i) => `Line ${i + 1}`,
      ).join('\n');
      const mockResult: ShellExecutionResult = {
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      // Set up the mock to resolve with our test data
      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout, // Map stdout to output field
        }),
      });

      // Act: Execute shell command with head_lines filter
      const invocation = shellTool.build({
        command: 'echo "test"',
        head_lines: 5,
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should only contain first 5 lines
      expect(result.llmContent).toContain('Line 1');
      expect(result.llmContent).toContain('Line 5');
      expect(result.llmContent).not.toContain('Line 6');
      expect(result.llmContent).not.toContain('Line 100');
    });

    it('should handle head_lines larger than total output lines', async () => {
      // Arrange
      const shortOutput = 'Line 1\nLine 2\nLine 3';
      const mockResult: ShellExecutionResult = {
        stdout: shortOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act
      const invocation = shellTool.build({
        command: 'echo "test"',
        head_lines: 10,
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should contain all lines
      expect(result.llmContent).toContain('Line 1');
      expect(result.llmContent).toContain('Line 2');
      expect(result.llmContent).toContain('Line 3');
    });

    it('should indicate when head_lines filter was applied', async () => {
      // Arrange
      const longOutput = Array.from(
        { length: 100 },
        (_, i) => `Line ${i + 1}`,
      ).join('\n');
      const mockResult: ShellExecutionResult = {
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act
      const invocation = shellTool.build({
        command: 'echo "test"',
        head_lines: 5,
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should indicate filtering was applied
      expect(result.returnDisplay).toContain('head_lines filter');
      expect(result.returnDisplay).toContain('showing first 5 lines');
    });
  });

  describe('tail_lines filtering', () => {
    it('should limit output to specified number of lines from the end', async () => {
      // Arrange: Create shell output with many lines
      const longOutput = Array.from(
        { length: 100 },
        (_, i) => `Line ${i + 1}`,
      ).join('\n');
      const mockResult: ShellExecutionResult = {
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act: Execute shell command with tail_lines filter
      const invocation = shellTool.build({
        command: 'echo "test"',
        tail_lines: 5,
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should only contain last 5 lines
      expect(result.llmContent).not.toContain('Line 95');
      expect(result.llmContent).toContain('Line 96');
      expect(result.llmContent).toContain('Line 100');
    });

    it('should indicate when tail_lines filter was applied', async () => {
      // Arrange
      const longOutput = Array.from(
        { length: 100 },
        (_, i) => `Line ${i + 1}`,
      ).join('\n');
      const mockResult: ShellExecutionResult = {
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act
      const invocation = shellTool.build({
        command: 'echo "test"',
        tail_lines: 3,
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should indicate filtering was applied
      expect(result.returnDisplay).toContain('tail_lines filter');
      expect(result.returnDisplay).toContain('showing last 3 lines');
    });
  });

  describe('grep_pattern filtering', () => {
    it('should filter output lines matching the grep pattern', async () => {
      // Arrange: Create shell output with mixed content
      const mixedOutput = [
        'ERROR: Database connection failed',
        'INFO: Application started',
        'ERROR: Invalid user credentials',
        'DEBUG: Processing request',
        'ERROR: File not found',
      ].join('\n');

      const mockResult: ShellExecutionResult = {
        stdout: mixedOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act: Execute shell command with grep_pattern filter
      const invocation = shellTool.build({
        command: 'echo "test"',
        grep_pattern: 'ERROR',
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should only contain ERROR lines
      expect(result.llmContent).toContain('Database connection failed');
      expect(result.llmContent).toContain('Invalid user credentials');
      expect(result.llmContent).toContain('File not found');
      expect(result.llmContent).not.toContain('Application started');
      expect(result.llmContent).not.toContain('Processing request');
    });

    it('should support case-insensitive grep with grep_flags', async () => {
      // Arrange
      const mixedOutput = [
        'Error: Database connection failed',
        'error: Invalid user credentials',
        'ERROR: File not found',
        'Info: Application started',
      ].join('\n');

      const mockResult: ShellExecutionResult = {
        stdout: mixedOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act
      const invocation = shellTool.build({
        command: 'echo "test"',
        grep_pattern: 'error',
        grep_flags: ['-i'],
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should contain all case variations
      expect(result.llmContent).toContain('Database connection failed');
      expect(result.llmContent).toContain('Invalid user credentials');
      expect(result.llmContent).toContain('File not found');
      expect(result.llmContent).not.toContain('Application started');
    });

    it('should support inverted grep with grep_flags', async () => {
      // Arrange
      const mixedOutput = [
        'ERROR: Database connection failed',
        'INFO: Application started',
        'ERROR: Invalid user credentials',
        'DEBUG: Processing request',
      ].join('\n');

      const mockResult: ShellExecutionResult = {
        stdout: mixedOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act
      const invocation = shellTool.build({
        command: 'echo "test"',
        grep_pattern: 'ERROR',
        grep_flags: ['-v'],
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should contain non-ERROR lines
      expect(result.llmContent).toContain('Application started');
      expect(result.llmContent).toContain('Processing request');
      expect(result.llmContent).not.toContain('Database connection failed');
      expect(result.llmContent).not.toContain('Invalid user credentials');
    });

    it('should indicate when grep_pattern filter was applied', async () => {
      // Arrange
      const mixedOutput = [
        'ERROR: Database connection failed',
        'INFO: Application started',
        'ERROR: Invalid user credentials',
      ].join('\n');

      const mockResult: ShellExecutionResult = {
        stdout: mixedOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act
      const invocation = shellTool.build({
        command: 'echo "test"',
        grep_pattern: 'ERROR',
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should indicate filtering was applied
      expect(result.returnDisplay).toContain('grep_pattern filter');
      expect(result.returnDisplay).toContain('ERROR');
    });
  });

  describe('combined filtering', () => {
    it('should apply head_lines and grep_pattern together', async () => {
      // Arrange
      const longOutput = Array.from({ length: 100 }, (_, i) =>
        i % 10 === 0 ? `ERROR: Line ${i + 1}` : `Line ${i + 1}`,
      ).join('\n');

      const mockResult: ShellExecutionResult = {
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act: Apply grep first, then head_lines
      const invocation = shellTool.build({
        command: 'echo "test"',
        grep_pattern: 'ERROR',
        head_lines: 3,
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should contain first 3 ERROR lines only
      const stdoutMatch = result.llmContent.match(/Stdout:([\s\S]*?)\nStderr:/);
      expect(stdoutMatch).not.toBeNull();
      const stdoutBlock = stdoutMatch ? stdoutMatch[1].trim() : '';
      const lines = stdoutBlock.split('\n').filter((line) => line.trim());
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const line of lines) {
        expect(line).toContain('ERROR');
      }
    });

    it('should apply tail_lines and grep_pattern together', async () => {
      // Arrange
      const longOutput = Array.from({ length: 100 }, (_, i) =>
        i % 10 === 0 ? `ERROR: Line ${i + 1}` : `Line ${i + 1}`,
      ).join('\n');

      const mockResult: ShellExecutionResult = {
        stdout: longOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Act: Apply grep first, then tail_lines
      const invocation = shellTool.build({
        command: 'echo "test"',
        grep_pattern: 'ERROR',
        tail_lines: 2,
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should contain last 2 ERROR lines only
      const stdoutMatch = result.llmContent.match(/Stdout:([\s\S]*?)\nStderr:/);
      expect(stdoutMatch).not.toBeNull();
      const stdoutBlock = stdoutMatch ? stdoutMatch[1].trim() : '';
      const lines = stdoutBlock.split('\n').filter((line) => line.trim());
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(2);
      for (const line of lines) {
        expect(line).toContain('ERROR');
      }
    });
  });

  describe('token limit enforcement post-JSON-escaping', () => {
    it('should prevent token limit exceeded after JSON escaping', async () => {
      // Create output with many unique words to exceed the low token limit
      const uniqueWords = Array.from(
        { length: 1000 },
        (_, i) => `uniqueWord${i}`,
      );
      const heavyOutput = uniqueWords.join(' ');

      const mockResult: ShellExecutionResult = {
        stdout: heavyOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Set very low token limit to trigger truncation
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-max-tokens': 100,
        'tool-output-truncate-mode': 'warn',
      });

      // Act
      const invocation = shellTool.build({
        command: 'echo "test"',
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should trigger warning due to token limit exceeded after escaping
      expect(result.llmContent).toContain('output exceeded token limit');
      expect(result.returnDisplay).toBe(heavyOutput);
    });

    it('should use accurate token estimation instead of 4-chars-per-token heuristic', async () => {
      // Arrange: Create output that the old heuristic would underestimate
      const shortLineHeavyOutput = Array.from({ length: 500 }, () => 'a').join(
        '\n',
      );

      const mockResult: ShellExecutionResult = {
        stdout: shortLineHeavyOutput,
        stderr: '',
        exitCode: 0,
        signal: null,
      };

      mockShellExecutionService.mockReturnValue({
        pid: 12345,
        result: Promise.resolve({
          ...mockResult,
          output: mockResult.stdout,
        }),
      });

      // Set token limit that old heuristic would think is safe
      mockConfig.getEphemeralSettings.mockReturnValue({
        'tool-output-max-tokens': 200,
        'tool-output-truncate-mode': 'warn',
      });

      // Act
      const invocation = shellTool.build({
        command: 'echo "test"',
      });
      const result = await invocation.execute(new AbortController().signal);

      // Assert: Should properly account for actual token count, not character count
      // Old heuristic: 500 chars / 4 = 125 tokens (would pass)
      // Real tiktoken: likely >200 tokens (should trigger warning)
      expect(result.llmContent).toContain('output exceeded token limit');
    });
  });

  describe('parameter validation', () => {
    // Note: Tests for head_lines, tail_lines, and grep_pattern validation that expected
    // the tool instance to reject for invalid parameters have been removed.
    // These were testing for earlier broken behavior where excessively large outputs
    // would cause promise rejections after escaping, rather than being gracefully
    // handled by token limiting.

    it('should validate grep_flags contains only valid flags', async () => {
      // Act & Assert
      await expect(
        shellTool
          .build({
            command: 'echo "test"',
            grep_pattern: 'test',
            grep_flags: ['-i', '-v', '-invalid'],
          })
          .execute(new AbortController().signal),
      ).rejects.toThrow();
    });
  });
});

// END OF FILE
