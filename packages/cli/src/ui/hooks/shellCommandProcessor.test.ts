/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook } from '../../test-utils/render.js';
import { act } from 'react';
import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';

const mockIsBinary = vi.hoisted(() => vi.fn());
const mockShellExecutionService = vi.hoisted(() => vi.fn());
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    ShellExecutionService: { execute: mockShellExecutionService },
    isBinary: mockIsBinary,
  };
});
vi.mock('fs');
// Mock os to always return 'linux' for consistent testing across platforms
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  const mockedOs = {
    ...actual,
    platform: vi.fn(() => 'linux'),
    tmpdir: vi.fn(() => '/tmp'),
    homedir: vi.fn(() => '/home/testuser'),
  };
  return {
    ...mockedOs,
    default: mockedOs,
  };
});
vi.mock('crypto');
vi.mock('../utils/textUtils.js');

import {
  useShellCommandProcessor,
  OUTPUT_UPDATE_INTERVAL_MS,
} from './shellCommandProcessor.js';
import {
  type Config,
  type GeminiClient,
  type ShellExecutionResult,
  type ShellOutputEvent,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs';
// import os from 'os'; // Not needed - mocked above
// import * as path from 'path';
import * as crypto from 'crypto';
import { ToolCallStatus } from '../types.js';

describe('useShellCommandProcessor', () => {
  let addItemToHistoryMock: Mock;
  let setPendingHistoryItemMock: Mock;
  let onExecMock: Mock;
  let onDebugMessageMock: Mock;
  let mockConfig: Config;
  let mockGeminiClient: GeminiClient;

  let mockShellOutputCallback: (event: ShellOutputEvent) => void;
  let resolveExecutionPromise: (result: ShellExecutionResult) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    addItemToHistoryMock = vi.fn();
    setPendingHistoryItemMock = vi.fn();
    onExecMock = vi.fn();
    onDebugMessageMock = vi.fn();
    mockConfig = {
      getTargetDir: () => '/test/dir',
      getShouldUseNodePtyShell: () => false,
    } as Config;
    mockGeminiClient = { addHistory: vi.fn() } as unknown as GeminiClient;

    // os functions are already mocked in the vi.mock call above
    // No need to re-mock them here
    (vi.mocked(crypto.randomBytes) as Mock).mockReturnValue(
      Buffer.from('abcdef', 'hex'),
    );
    mockIsBinary.mockReturnValue(false);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    mockShellExecutionService.mockImplementation(
      (_cmd, _cwd, callback, _signal, _usePty) => {
        mockShellOutputCallback = callback;
        return {
          pid: 12345,
          result: new Promise((resolve) => {
            resolveExecutionPromise = resolve;
          }),
        };
      },
    );
  });

  const renderProcessorHook = () =>
    renderHook(() =>
      useShellCommandProcessor(
        addItemToHistoryMock,
        setPendingHistoryItemMock,
        onExecMock,
        onDebugMessageMock,
        mockConfig,
        mockGeminiClient,
        () => {},
        80,
        24,
      ),
    );

  const createMockServiceResult = (
    overrides: Partial<ShellExecutionResult> = {},
  ): ShellExecutionResult => ({
    rawOutput: Buffer.from(overrides.output || ''),
    output: 'Success',
    exitCode: 0,
    signal: null,
    error: null,
    aborted: false,
    pid: 12345,
    executionMethod: 'child_process',
    ...overrides,
  });

  it('should initiate command execution and set pending state', async () => {
    const { result } = renderProcessorHook();

    act(() => {
      result.current.handleShellCommand('ls -l', new AbortController().signal);
    });

    expect(addItemToHistoryMock).toHaveBeenCalledWith(
      { type: 'user_shell', text: 'ls -l' },
      expect.any(Number),
    );
    expect(setPendingHistoryItemMock).toHaveBeenCalledWith({
      type: 'tool_group',
      agentId: 'primary',
      tools: [
        expect.objectContaining({
          name: 'Shell Command',
          status: ToolCallStatus.Executing,
        }),
      ],
    });
    expect(mockShellExecutionService).toHaveBeenCalledWith(
      expect.stringMatching(
        /^{ ls -l; }; __code=\$\?; pwd > ".*shell_pwd_abcdef\.tmp"; exit \$__code$/,
      ),
      '/test/dir',
      expect.any(Function),
      expect.any(Object),
      false,
    );
    expect(onExecMock).toHaveBeenCalledWith(expect.any(Promise));
  });

  it('should handle successful execution and update history correctly', async () => {
    const { result } = renderProcessorHook();

    act(() => {
      result.current.handleShellCommand(
        'echo "ok"',
        new AbortController().signal,
      );
    });
    const execPromise = onExecMock.mock.calls[0][0];

    act(() => {
      resolveExecutionPromise(createMockServiceResult({ output: 'ok' }));
    });
    await act(async () => await execPromise);

    expect(setPendingHistoryItemMock).toHaveBeenCalledWith(null);
    expect(addItemToHistoryMock).toHaveBeenCalledTimes(2); // Initial + final
    expect(addItemToHistoryMock.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            status: ToolCallStatus.Success,
            resultDisplay: 'ok',
          }),
        ],
      }),
    );
    expect(mockGeminiClient.addHistory).toHaveBeenCalled();
  });

  it('should handle command failure and display error status', async () => {
    const { result } = renderProcessorHook();

    act(() => {
      result.current.handleShellCommand(
        'bad-cmd',
        new AbortController().signal,
      );
    });
    const execPromise = onExecMock.mock.calls[0][0];

    act(() => {
      resolveExecutionPromise(
        createMockServiceResult({ exitCode: 127, output: 'not found' }),
      );
    });
    await act(async () => await execPromise);

    const finalHistoryItem = addItemToHistoryMock.mock.calls[1][0];
    expect(finalHistoryItem.tools[0].status).toBe(ToolCallStatus.Error);
    expect(finalHistoryItem.tools[0].resultDisplay).toContain(
      'Command exited with code 127',
    );
    expect(finalHistoryItem.tools[0].resultDisplay).toContain('not found');
  });

  describe('UI Streaming and Throttling', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('should throttle pending UI updates for text streams', async () => {
      const { result } = renderProcessorHook();
      act(() => {
        result.current.handleShellCommand(
          'stream',
          new AbortController().signal,
        );
      });

      // Simulate rapid output
      act(() => {
        mockShellOutputCallback({
          type: 'data',
          chunk: 'hello',
        });
      });

      // Should not have updated the UI yet
      expect(setPendingHistoryItemMock).toHaveBeenCalledTimes(1); // Only the initial call

      // Advance time and send another event to trigger the throttled update
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OUTPUT_UPDATE_INTERVAL_MS + 1);
      });
      act(() => {
        mockShellOutputCallback({
          type: 'data',
          chunk: ' world',
        });
      });

      // Should now have been called with the cumulative output
      expect(setPendingHistoryItemMock).toHaveBeenCalledTimes(2);
      expect(setPendingHistoryItemMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tools: [expect.objectContaining({ resultDisplay: 'hello world' })],
        }),
      );
    });

    it('should show binary progress messages correctly', async () => {
      const { result } = renderProcessorHook();
      act(() => {
        result.current.handleShellCommand(
          'cat img',
          new AbortController().signal,
        );
      });

      // Should immediately show the detection message
      act(() => {
        mockShellOutputCallback({ type: 'binary_detected' });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OUTPUT_UPDATE_INTERVAL_MS + 1);
      });
      // Send another event to trigger the update
      act(() => {
        mockShellOutputCallback({ type: 'binary_progress', bytesReceived: 0 });
      });

      expect(setPendingHistoryItemMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              resultDisplay: '[Binary output detected. Halting stream...]',
            }),
          ],
        }),
      );

      // Now test progress updates
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OUTPUT_UPDATE_INTERVAL_MS + 1);
      });
      act(() => {
        mockShellOutputCallback({
          type: 'binary_progress',
          bytesReceived: 2048,
        });
      });

      expect(setPendingHistoryItemMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tools: [
            expect.objectContaining({
              resultDisplay: '[Receiving binary output... 2.0 KB received]',
            }),
          ],
        }),
      );
    });
  });

  it('should wrap the command on non-Windows systems to capture working directory', async () => {
    // Default mock platform is 'linux', which should trigger command wrapping
    const { result } = renderProcessorHook();

    act(() => {
      result.current.handleShellCommand('dir', new AbortController().signal);
    });

    // On non-Windows systems, command should be wrapped to capture working directory
    expect(mockShellExecutionService).toHaveBeenCalledWith(
      expect.stringContaining('{ dir; }; __code=$?; pwd >'),
      '/test/dir',
      expect.any(Function),
      expect.any(Object),
      false,
    );
  });

  it('should handle command abort and display cancelled status', async () => {
    const { result } = renderProcessorHook();
    const abortController = new AbortController();

    act(() => {
      result.current.handleShellCommand('sleep 5', abortController.signal);
    });
    const execPromise = onExecMock.mock.calls[0][0];

    act(() => {
      abortController.abort();
      resolveExecutionPromise(
        createMockServiceResult({ aborted: true, output: 'Canceled' }),
      );
    });
    await act(async () => await execPromise);

    const finalHistoryItem = addItemToHistoryMock.mock.calls[1][0];
    expect(finalHistoryItem.tools[0].status).toBe(ToolCallStatus.Canceled);
    expect(finalHistoryItem.tools[0].resultDisplay).toContain(
      'Command was cancelled.',
    );
  });

  it('should handle binary output result correctly', async () => {
    const { result } = renderProcessorHook();
    const binaryBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mockIsBinary.mockReturnValue(true);

    act(() => {
      result.current.handleShellCommand(
        'cat image.png',
        new AbortController().signal,
      );
    });
    const execPromise = onExecMock.mock.calls[0][0];

    act(() => {
      resolveExecutionPromise(
        createMockServiceResult({ rawOutput: binaryBuffer }),
      );
    });
    await act(async () => await execPromise);

    const finalHistoryItem = addItemToHistoryMock.mock.calls[1][0];
    expect(finalHistoryItem.tools[0].status).toBe(ToolCallStatus.Success);
    expect(finalHistoryItem.tools[0].resultDisplay).toBe(
      '[Command produced binary output, which is not shown.]',
    );
  });

  it('should handle promise rejection and show an error', async () => {
    const { result } = renderProcessorHook();
    const testError = new Error('Unexpected failure');
    mockShellExecutionService.mockImplementation(() => ({
      pid: 12345,
      result: Promise.reject(testError),
    }));

    act(() => {
      result.current.handleShellCommand(
        'a-command',
        new AbortController().signal,
      );
    });
    const execPromise = onExecMock.mock.calls[0][0];

    await act(async () => await execPromise);

    expect(setPendingHistoryItemMock).toHaveBeenCalledWith(null);
    expect(addItemToHistoryMock).toHaveBeenCalledTimes(2);
    expect(addItemToHistoryMock.mock.calls[1][0]).toEqual({
      type: 'error',
      text: 'An unexpected error occurred: Unexpected failure',
    });
  });

  it('should handle synchronous errors during execution and clean up resources', async () => {
    const testError = new Error('Synchronous spawn error');
    mockShellExecutionService.mockImplementation(() => {
      throw testError;
    });
    // Mock that the temp file was created before the error was thrown
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const { result } = renderProcessorHook();

    act(() => {
      result.current.handleShellCommand(
        'a-command',
        new AbortController().signal,
      );
    });
    const execPromise = onExecMock.mock.calls[0][0];

    await act(async () => await execPromise);

    expect(setPendingHistoryItemMock).toHaveBeenCalledWith(null);
    expect(addItemToHistoryMock).toHaveBeenCalledTimes(2);
    expect(addItemToHistoryMock.mock.calls[1][0]).toEqual({
      type: 'error',
      text: 'An unexpected error occurred: Synchronous spawn error',
    });
    // Verify that the temporary file was cleaned up
    expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalledWith(
      expect.stringMatching(/.*shell_pwd_abcdef\.tmp$/),
    );
  });

  describe('Directory Change Warning', () => {
    it('should show a warning if the working directory changes', async () => {
      const tmpFile = expect.stringMatching(/.*shell_pwd_abcdef\.tmp$/);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('/test/dir/new'); // A different directory

      const { result } = renderProcessorHook();
      act(() => {
        result.current.handleShellCommand(
          'cd new',
          new AbortController().signal,
        );
      });
      const execPromise = onExecMock.mock.calls[0][0];

      act(() => {
        resolveExecutionPromise(createMockServiceResult());
      });
      await act(async () => await execPromise);

      const finalHistoryItem = addItemToHistoryMock.mock.calls[1][0];
      expect(finalHistoryItem.tools[0].resultDisplay).toContain(
        "WARNING: shell mode is stateless; the directory change to '/test/dir/new' will not persist.",
      );
      expect(vi.mocked(fs.unlinkSync)).toHaveBeenCalledWith(tmpFile);
    });

    it('should NOT show a warning if the directory does not change', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('/test/dir'); // The same directory

      const { result } = renderProcessorHook();
      act(() => {
        result.current.handleShellCommand('ls', new AbortController().signal);
      });
      const execPromise = onExecMock.mock.calls[0][0];

      act(() => {
        resolveExecutionPromise(createMockServiceResult());
      });
      await act(async () => await execPromise);

      const finalHistoryItem = addItemToHistoryMock.mock.calls[1][0];
      expect(finalHistoryItem.tools[0].resultDisplay).not.toContain('WARNING');
    });
  });
});
