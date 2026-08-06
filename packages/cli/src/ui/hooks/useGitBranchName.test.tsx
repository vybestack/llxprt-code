/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { useGitBranchName, FETCH_DEBOUNCE_MS } from './useGitBranchName.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Mock child_process, fs, and fs/promises with explicit factory functions
// so the mocked exports are proper vi.fn() instances under Bun.
const mockExecFn = vi.fn();
const mockWatchFile = vi.fn();
const mockUnwatchFile = vi.fn();
const mockAccess = vi.fn();

void vi.mock('node:child_process', () => ({
  exec: mockExecFn,
}));
void vi.mock('node:fs', () => ({
  default: {
    watchFile: mockWatchFile,
    unwatchFile: mockUnwatchFile,
    constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
  },
  watchFile: mockWatchFile,
  unwatchFile: mockUnwatchFile,
  constants: { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 },
}));
void vi.mock('node:fs/promises', () => ({
  default: {
    access: mockAccess,
  },
  access: mockAccess,
}));

const CWD = process.platform === 'win32' ? '\\test\\project' : '/test/project';
const GIT_LOGS_HEAD_PATH = path.join(CWD, '.git', 'logs', 'HEAD');

type WatchFileCallback = (curr: fs.Stats, prev: fs.Stats) => void;

function createWatchFileCapture() {
  let callback: WatchFileCallback | null = null;
  mockWatchFile.mockImplementation(((
    _filename: fs.PathLike,
    optionsOrListener: unknown,
    maybeListener?: WatchFileCallback,
  ): fs.StatWatcher => {
    const listener =
      typeof optionsOrListener === 'function'
        ? (optionsOrListener as WatchFileCallback)
        : maybeListener;
    if (listener) {
      callback = listener;
    }
    return {} as unknown as fs.StatWatcher;
  }) as typeof fs.watchFile);
  return {
    spy: mockWatchFile,
    getCallback: (): WatchFileCallback => {
      if (!callback) throw new Error('watchFile callback not captured yet');
      return callback;
    },
    getListener: (): WatchFileCallback | null => callback,
  };
}

function mockExecReturn(...values: string[]) {
  let callCount = 0;
  mockExecFn.mockImplementation(
    (_command: string, _options: unknown, callback?: unknown) => {
      const value = values[Math.min(callCount, values.length - 1)];
      callCount++;
      (callback as ((...args: unknown[]) => void) | undefined)?.(
        null,
        value,
        '',
      );
      return new EventEmitter() as ChildProcess;
    },
  );
  return () => callCount;
}

describe('useGitBranchName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAccess.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return branch name', async () => {
    mockExecReturn('main\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });

    expect(result.current).toBe('main');
  });

  it('should return undefined if git command fails', async () => {
    mockExecFn.mockImplementation((_command, _options, callback) => {
      callback?.(new Error('Git error'), '', 'error output');
      return new EventEmitter() as ChildProcess;
    });

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));
    expect(result.current).toBeUndefined();

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBeUndefined();
  });

  it('should return short commit hash if branch is HEAD (detached state)', async () => {
    mockExecFn.mockImplementation((command, _options, callback) => {
      if (command === 'git rev-parse --abbrev-ref HEAD') {
        callback?.(null, 'HEAD\n', '');
      } else if (command === 'git rev-parse --short HEAD') {
        callback?.(null, 'a1b2c3d\n', '');
      }
      return new EventEmitter() as ChildProcess;
    });

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));
    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('a1b2c3d');
  });

  it('should return undefined if branch is HEAD and getting commit hash fails', async () => {
    mockExecFn.mockImplementation((command, _options, callback) => {
      if (command === 'git rev-parse --abbrev-ref HEAD') {
        callback?.(null, 'HEAD\n', '');
      } else if (command === 'git rev-parse --short HEAD') {
        callback?.(new Error('Git error'), '', 'error output');
      }
      return new EventEmitter() as ChildProcess;
    });

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));
    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBeUndefined();
  });

  it('should update branch name when .git/logs/HEAD changes', async () => {
    const capture = createWatchFileCapture();
    mockExecReturn('main\n', 'develop\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('main');

    await waitFor(() => {
      expect(capture.spy).toHaveBeenCalled();
    });

    await act(async () => {
      capture.getCallback()(
        { mtimeMs: 2000 } as fs.Stats,
        { mtimeMs: 1000 } as fs.Stats,
      );
      vi.advanceTimersByTime(FETCH_DEBOUNCE_MS);
      rerender();
    });

    expect(result.current).toBe('develop');
    expect(fs.watchFile).toHaveBeenCalledWith(
      GIT_LOGS_HEAD_PATH,
      { interval: 3000 },
      expect.any(Function),
    );
  });

  it('should handle watcher setup error silently', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockExecReturn('main\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });

    expect(result.current).toBe('main');
    expect(fs.watchFile).not.toHaveBeenCalled();
  });

  it('should cleanup watcher on unmount with the same listener reference', async () => {
    const capture = createWatchFileCapture();
    mockExecReturn('main\n');

    const { unmount, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });

    await waitFor(() => {
      expect(capture.spy).toHaveBeenCalledWith(
        GIT_LOGS_HEAD_PATH,
        { interval: 3000 },
        expect.any(Function),
      );
    });

    unmount();

    expect(fs.unwatchFile).toHaveBeenCalledWith(
      GIT_LOGS_HEAD_PATH,
      capture.getListener(),
    );
  });

  it('should not refetch when mtimeMs and size are unchanged', async () => {
    const capture = createWatchFileCapture();
    const getCallCount = mockExecReturn('main\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('main');

    await waitFor(() => {
      expect(capture.spy).toHaveBeenCalled();
    });

    const callsBeforePoll = getCallCount();

    await act(async () => {
      capture.getCallback()(
        { mtimeMs: 1000, size: 42 } as fs.Stats,
        { mtimeMs: 1000, size: 42 } as fs.Stats,
      );
      vi.advanceTimersByTime(FETCH_DEBOUNCE_MS);
      rerender();
    });

    expect(getCallCount()).toBe(callsBeforePoll);
    expect(result.current).toBe('main');
  });

  it('should refetch when only size changes', async () => {
    const capture = createWatchFileCapture();
    mockExecReturn('main\n', 'develop\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('main');

    await waitFor(() => {
      expect(capture.spy).toHaveBeenCalled();
    });

    await act(async () => {
      capture.getCallback()(
        { mtimeMs: 1000, size: 99 } as fs.Stats,
        { mtimeMs: 1000, size: 42 } as fs.Stats,
      );
      vi.advanceTimersByTime(FETCH_DEBOUNCE_MS);
      rerender();
    });

    expect(result.current).toBe('develop');
  });

  it('should refetch when only mtimeMs changes', async () => {
    const capture = createWatchFileCapture();
    mockExecReturn('main\n', 'develop\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('main');

    await waitFor(() => {
      expect(capture.spy).toHaveBeenCalled();
    });

    await act(async () => {
      capture.getCallback()(
        { mtimeMs: 2000, size: 42 } as fs.Stats,
        { mtimeMs: 1000, size: 42 } as fs.Stats,
      );
      vi.advanceTimersByTime(FETCH_DEBOUNCE_MS);
      rerender();
    });

    expect(result.current).toBe('develop');
  });

  it('should not register watchFile if unmounted before access resolves', async () => {
    let resolveAccess: () => void = () => {};
    mockAccess.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAccess = resolve;
        }),
    );

    mockExecReturn('main\n');

    const { unmount, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });

    unmount();

    await act(async () => {
      resolveAccess();
    });

    expect(fs.watchFile).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Issue #1186: Race condition with compound git commands.
  //
  // When a compound command like `git checkout main && git fetch && git pull`
  // writes to `.git/logs/HEAD` multiple times in quick succession, overlapping
  // exec() callbacks can resolve out of order, causing the stale (earlier)
  // result to overwrite the correct (latest) branch name.
  // ---------------------------------------------------------------------------

  it('should ignore stale exec result when a newer fetch supersedes it', async () => {
    const capture = createWatchFileCapture();

    // Simulate compound command: initial fetch returns 'feature-branch',
    // then two watcher events fire in quick succession. The first exec
    // (for the first watcher event) resolves slowly with the OLD branch,
    // while the second exec (for the second watcher event) resolves quickly
    // with the NEW branch. Without a fetch token, the slow first exec would
    // overwrite the correct result.
    let callIndex = 0;
    let firstExecCallback:
      | ((error: Error | null, stdout: string, stderr: string) => void)
      | null = null;
    mockExecFn.mockImplementation((_command, _options, callback) => {
      callIndex++;
      if (callIndex === 1) {
        // Initial fetch — resolves immediately with 'feature-branch'
        callback?.(null, 'feature-branch\n', '');
      } else if (callIndex === 2) {
        // First watcher fetch — capture callback, do NOT resolve yet (stale)
        firstExecCallback = callback ?? null;
      } else {
        // Second watcher fetch — resolves immediately with 'main'
        callback?.(null, 'main\n', '');
      }
      return new EventEmitter() as ChildProcess;
    });

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('feature-branch');

    await waitFor(() => {
      expect(capture.spy).toHaveBeenCalled();
    });

    // Fire two rapid watcher events (compound command writes reflog multiple times)
    await act(async () => {
      capture.getCallback()(
        { mtimeMs: 2000, size: 100 } as fs.Stats,
        { mtimeMs: 1000, size: 50 } as fs.Stats,
      );
      // Advance fake timers so the debounce fires the first fetch
      vi.advanceTimersByTime(FETCH_DEBOUNCE_MS);
      capture.getCallback()(
        { mtimeMs: 3000, size: 150 } as fs.Stats,
        { mtimeMs: 2000, size: 100 } as fs.Stats,
      );
      vi.advanceTimersByTime(FETCH_DEBOUNCE_MS);
      rerender();
    });

    // The second fetch (callIndex 3) resolved with 'main', so we should see 'main'
    expect(result.current).toBe('main');

    // Now the stale first fetch (callIndex 2) resolves with the old branch
    await act(async () => {
      firstExecCallback?.(null, 'feature-branch\n', '');
      rerender();
    });

    // The stale result should be IGNORED — branch should remain 'main'
    expect(result.current).toBe('main');
  });

  it('should debounce rapid watcher callbacks so only one exec fires after a burst', async () => {
    const capture = createWatchFileCapture();
    const getCallCount = mockExecReturn('main\n', 'develop\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      vi.runAllTimers();
      rerender();
    });
    expect(result.current).toBe('main');

    await waitFor(() => {
      expect(capture.spy).toHaveBeenCalled();
    });

    const callsBeforeBurst = getCallCount();

    // Fire three rapid watcher callbacks (simulating compound command reflog writes)
    await act(async () => {
      capture.getCallback()(
        { mtimeMs: 2000, size: 100 } as fs.Stats,
        { mtimeMs: 1000, size: 50 } as fs.Stats,
      );
      capture.getCallback()(
        { mtimeMs: 2500, size: 120 } as fs.Stats,
        { mtimeMs: 2000, size: 100 } as fs.Stats,
      );
      capture.getCallback()(
        { mtimeMs: 3000, size: 150 } as fs.Stats,
        { mtimeMs: 2500, size: 120 } as fs.Stats,
      );
      rerender();
    });

    // Before debounce fires, no new exec should have been called
    expect(getCallCount()).toBe(callsBeforeBurst);

    // Advance past debounce window
    await act(async () => {
      vi.advanceTimersByTime(FETCH_DEBOUNCE_MS);
      rerender();
    });

    // Only ONE additional exec call should have fired (debounce coalesced the burst)
    expect(getCallCount()).toBe(callsBeforeBurst + 1);
    expect(result.current).toBe('develop');
  });
});
