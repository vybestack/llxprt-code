/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  MockedFunction,
} from 'vitest';
import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { useGitBranchName } from './useGitBranchName';
import { EventEmitter } from 'node:events';
import { exec as mockExec, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

// Mock child_process
vi.mock('child_process');

// Mock fs and fs/promises
vi.mock('node:fs');
vi.mock('node:fs/promises');

const CWD = '/test/project';
const GIT_LOGS_HEAD_PATH = `${CWD}/.git/logs/HEAD`;

describe('useGitBranchName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers(); // Use fake timers for async operations

    // Mock fsPromises.access to always succeed
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it('should return branch name', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        callback?.(null, 'main\n', '');
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers(); // Advance timers to trigger useEffect and exec callback
      rerender(); // Rerender to get the updated state
    });

    expect(result.current).toBe('main');
  });

  it('should return undefined if git command fails', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        callback?.(new Error('Git error'), '', 'error output');
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));
    expect(result.current).toBeUndefined();

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBeUndefined();
  });

  it('should return short commit hash if branch is HEAD (detached state)', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (command, _options, callback) => {
        if (command === 'git rev-parse --abbrev-ref HEAD') {
          callback?.(null, 'HEAD\n', '');
        } else if (command === 'git rev-parse --short HEAD') {
          callback?.(null, 'a1b2c3d\n', '');
        }
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));
    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('a1b2c3d');
  });

  it('should return undefined if branch is HEAD and getting commit hash fails', async () => {
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (command, _options, callback) => {
        if (command === 'git rev-parse --abbrev-ref HEAD') {
          callback?.(null, 'HEAD\n', '');
        } else if (command === 'git rev-parse --short HEAD') {
          callback?.(new Error('Git error'), '', 'error output');
        }
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));
    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBeUndefined();
  });

  it('should update branch name when .git/HEAD changes', async () => {
    // Create a mock watcher
    const mockWatcher = {
      close: vi.fn(),
    };

    let watchCallback: ((eventType: string) => void) | null = null;

    vi.mocked(fs.watch).mockImplementation((path, callback) => {
      watchCallback = callback as (eventType: string) => void;
      return mockWatcher as unknown as fs.FSWatcher;
    });

    let callCount = 0;
    // Mock exec to return different values on each call
    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        if (callCount === 0) {
          callCount++;
          callback?.(null, 'main\n', '');
        } else {
          callback?.(null, 'develop\n', '');
        }
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('main');
    expect(watchCallback).toBeTruthy();

    // Simulate file change event
    await act(async () => {
      watchCallback!('change');
      vi.runAllTimers();
      rerender();
    });

    expect(result.current).toBe('develop');
    expect(fs.watch).toHaveBeenCalledWith(
      GIT_LOGS_HEAD_PATH,
      expect.any(Function),
    );
  });

  it('should handle watcher setup error silently', async () => {
    // Make fsPromises.access reject to simulate file not existing
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'));

    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        callback?.(null, 'main\n', '');
        return new EventEmitter() as ChildProcess;
      },
    );

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });

    expect(result.current).toBe('main'); // Branch name should still be fetched initially

    // Verify that fs.watch was never called since access check failed
    expect(fs.watch).not.toHaveBeenCalled();
  });

  it('should cleanup watcher on unmount', async () => {
    const closeMock = vi.fn();
    const watcherEmitter = new EventEmitter();
    const mockWatcher = {
      close: closeMock,
      ...watcherEmitter,
    };

    vi.mocked(fs.watch).mockReturnValue(mockWatcher as unknown as fs.FSWatcher);

    (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
      (_command, _options, callback) => {
        callback?.(null, 'main\n', '');
        return new EventEmitter() as ChildProcess;
      },
    );

    const { unmount, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });

    // Verify watcher was set up
    expect(fs.watch).toHaveBeenCalledWith(
      GIT_LOGS_HEAD_PATH,
      expect.any(Function),
    );

    // Unmount and verify cleanup
    unmount();
    expect(closeMock).toHaveBeenCalled();
  });
});
