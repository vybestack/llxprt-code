/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MockedFunction } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import { useGitBranchName } from './useGitBranchName.js';
import { EventEmitter } from 'node:events';
import { exec as mockExec, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

// Mock child_process
vi.mock('child_process');

// Mock fs and fs/promises
vi.mock('node:fs');
vi.mock('node:fs/promises');

const CWD = process.platform === 'win32' ? '\\test\\project' : '/test/project';
const GIT_LOGS_HEAD_PATH = path.join(CWD, '.git', 'logs', 'HEAD');

type WatchFileCallback = (curr: fs.Stats, prev: fs.Stats) => void;

function createWatchFileCapture() {
  let callback: WatchFileCallback | null = null;
  const spy = vi.mocked(fs.watchFile).mockImplementation(((
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
    spy,
    getCallback: (): WatchFileCallback => {
      if (!callback) throw new Error('watchFile callback not captured yet');
      return callback;
    },
    getListener: (): WatchFileCallback | null => callback,
  };
}

function mockExecReturn(...values: string[]) {
  let callCount = 0;
  (mockExec as MockedFunction<typeof mockExec>).mockImplementation(
    (_command, _options, callback) => {
      const value = values[Math.min(callCount, values.length - 1)];
      callCount++;
      callback?.(null, value, '');
      return new EventEmitter() as ChildProcess;
    },
  );
  return () => callCount;
}

describe('useGitBranchName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return branch name', async () => {
    mockExecReturn('main\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      rerender();
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
      rerender();
    });
    expect(result.current).toBeUndefined();
  });

  it('should update branch name when .git/logs/HEAD changes', async () => {
    const capture = createWatchFileCapture();
    mockExecReturn('main\n', 'develop\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
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
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('ENOENT'));
    mockExecReturn('main\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
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
      rerender();
    });

    expect(result.current).toBe('develop');
  });

  it('should refetch when only mtimeMs changes', async () => {
    const capture = createWatchFileCapture();
    mockExecReturn('main\n', 'develop\n');

    const { result, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
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
      rerender();
    });

    expect(result.current).toBe('develop');
  });

  it('should not register watchFile if unmounted before access resolves', async () => {
    let resolveAccess: () => void = () => {};
    vi.mocked(fsPromises.access).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAccess = resolve;
        }),
    );

    mockExecReturn('main\n');

    const { unmount, rerender } = renderHook(() => useGitBranchName(CWD));

    await act(async () => {
      rerender();
    });

    unmount();

    await act(async () => {
      resolveAccess();
    });

    expect(fs.watchFile).not.toHaveBeenCalled();
  });
});
