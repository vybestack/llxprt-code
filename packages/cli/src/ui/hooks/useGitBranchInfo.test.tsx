/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan project-plans/issue3238.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { renderHook, waitFor } from '../../test-utils/render.js';
import {
  useGitBranchInfo,
  FETCH_DEBOUNCE_MS,
  GIT_WATCH_POLL_MS,
} from './useGitBranchInfo.js';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import path from 'node:path';

const mockExec = vi.fn();
const mockWatchFile = vi.fn();
const mockUnwatchFile = vi.fn();
const mockAccess = vi.fn();

void vi.mock('node:child_process', () => ({ exec: mockExec }));
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
  default: { access: mockAccess },
  access: mockAccess,
}));

import type { ChildProcess } from 'node:child_process';

const CWD = process.platform === 'win32' ? '\\test\\project' : '/test/project';
const LOGS_HEAD = path.join(CWD, '.git', 'logs', 'HEAD');
const INDEX = path.join(CWD, '.git', 'index');

type ExecCb = (err: Error | null, out: string, errOut: string) => void;
type WatcherOptions =
  | WatchFileCallback
  | { interval: number }
  | ((curr: unknown, prev: unknown) => void);
type WatchFileCallback = (curr: unknown, prev: unknown) => void;

function eventEmitter(): ChildProcess {
  return {} as unknown as ChildProcess;
}

function setupExec(onExec: (cmd: string, cb: ExecCb) => void) {
  mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
    onExec(cmd, cb);
    return eventEmitter();
  });
}

function watchCapture() {
  const listeners = new Map<string, WatchFileCallback>();
  mockWatchFile.mockImplementation(
    (file: string, opts?: WatcherOptions, maybe?: WatchFileCallback) => {
      const cb = typeof opts === 'function' ? opts : maybe;
      if (cb) listeners.set(file, cb);
      return eventEmitter();
    },
  );
  return {
    listeners,
    fire: (file: string, curr: unknown, prev: unknown) => {
      const cb = listeners.get(file);
      expect(cb).toBeDefined();
      cb?.(curr, prev);
    },
  };
}

describe('useGitBranchInfo', () => {
  beforeEach(() => {
    mockAccess.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mockAccess.mockReset();
    mockExec.mockReset();
    mockWatchFile.mockReset();
    mockUnwatchFile.mockReset();
    vi.useRealTimers();
  });

  it('reports a clean work tree as { branchName, isDirty: false }', async () => {
    setupExec((cmd, cb) => {
      if (cmd === 'git status --porcelain') cb(null, '', '');
      else if (cmd === 'git rev-parse --abbrev-ref HEAD')
        cb(null, 'main\n', '');
      else cb(null, 'abc1234\n', '');
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(mockExec).toHaveBeenCalledWith(
      'git status --porcelain',
      expect.anything(),
      expect.any(Function),
    );
    expect(result.current).toEqual({ branchName: 'main', isDirty: false });
  });

  it('reports a modified work tree as dirty', async () => {
    setupExec((cmd, cb) => {
      if (cmd === 'git status --porcelain') cb(null, ' M src/file.ts\n', '');
      else cb(null, 'main\n', '');
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current).toEqual({ branchName: 'main', isDirty: true });
  });

  it('runs every git command with a bounded buffer and timeout', async () => {
    setupExec((cmd, cb) => {
      if (cmd === 'git status --porcelain') cb(null, '', '');
      else cb(null, 'main', '');
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current).toEqual({ branchName: 'main', isDirty: false });
    const statusCall = mockExec.mock.calls.find(
      (call: unknown[]) => call[0] === 'git status --porcelain',
    );
    const statusOpts = statusCall?.[1] as {
      maxBuffer?: number;
      timeout?: number;
    };
    expect(statusOpts.maxBuffer).toBeGreaterThan(1024 * 1024);
    expect(statusOpts.timeout).toBeGreaterThan(0);
  });

  it('reports undefined branch and clean work tree on git errors', async () => {
    setupExec((cmd, cb) => {
      cb(new Error('not a repo'), '', '');
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current).toEqual({ branchName: undefined, isDirty: false });
  });

  it('reports a clean detached HEAD as a short hash without a star', async () => {
    setupExec((cmd, cb) => {
      if (cmd === 'git status --porcelain') cb(null, '', '');
      else if (cmd === 'git rev-parse --abbrev-ref HEAD')
        cb(null, 'HEAD\n', '');
      else cb(null, 'a1b2c3d\n', '');
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current).toEqual({ branchName: 'a1b2c3d', isDirty: false });
  });

  it('registers a watcher on both .git/logs/HEAD and .git/index', async () => {
    const capture = watchCapture();
    setupExec((cmd, cb) => {
      if (cmd === 'git status --porcelain') cb(null, '', '');
      else if (cmd === 'git rev-parse --abbrev-ref HEAD')
        cb(null, 'main\n', '');
      else cb(null, 'abc1234\n', '');
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current.branchName).toBe('main');

    await waitFor(() => {
      expect(mockWatchFile).toHaveBeenCalled();
    });

    // An index write (a file edit or stage) flips the watcher and refetches.
    await act(async () => {
      capture.fire(
        INDEX,
        { mtimeMs: 2000, size: 100 },
        { mtimeMs: 1000, size: 50 },
      );
      rerender();
    });

    expect(mockWatchFile).toHaveBeenCalledWith(
      INDEX,
      { interval: 3000 },
      capture.listeners.get(INDEX),
    );
    expect(result.current.branchName).toBe('main');
  });

  it('skips watchers when .git files are missing', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockExec.mockReset();
    mockWatchFile.mockReset();
    mockUnwatchFile.mockReset();
    setupExec((cmd, cb) => {
      cb(new Error('not a repo'), '', '');
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current.branchName).toBeUndefined();
    expect(mockWatchFile).not.toHaveBeenCalled();
  });

  it('refetches when a second watcher event fires after the debounce', async () => {
    const capture = watchCapture();
    setupExec((cmd, cb) => {
      if (cmd === 'git rev-parse --abbrev-ref HEAD') cb(null, 'main\n', '');
      else if (cmd === 'git status --porcelain') cb(null, ' M f\n', '');
      else cb(null, 'x\n', '');
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current.isDirty).toBe(true);

    await waitFor(() => {
      expect(mockWatchFile).toHaveBeenCalled();
    });

    await act(async () => {
      capture.fire(
        LOGS_HEAD,
        { mtimeMs: 2000, size: 100 },
        { mtimeMs: 1000, size: 50 },
      );
      rerender();
    });

    expect(result.current.isDirty).toBe(true);
  });

  it('unwatches both files on unmount with the same listeners', async () => {
    const capture = watchCapture();
    setupExec((cmd, cb) => {
      if (cmd === 'git rev-parse --abbrev-ref HEAD') cb(null, 'main\n', '');
      else if (cmd === 'git status --porcelain') cb(null, '', '');
      else cb(null, 'x\n', '');
    });

    const { unmount, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    await waitFor(() => {
      expect(mockWatchFile).toHaveBeenCalled();
    });

    const logListener = capture.listeners.get(LOGS_HEAD);
    const indexListener = capture.listeners.get(INDEX);
    expect(logListener).toBeDefined();
    expect(indexListener).toBeDefined();

    unmount();

    expect(mockUnwatchFile).toHaveBeenCalledWith(LOGS_HEAD, logListener);
    expect(mockUnwatchFile).toHaveBeenCalledWith(INDEX, indexListener);
  });

  it('flips clean -> dirty when a watcher event fires and the debounce elapses', async () => {
    vi.useFakeTimers();
    let statusDirty = false;
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
      if (cmd === 'git status --porcelain')
        cb(null, statusDirty ? ' M f' : '', '');
      else cb(null, 'main', '');
      return eventEmitter();
    });
    const capture = watchCapture();

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current.isDirty).toBe(false);

    await waitFor(() => {
      expect(mockWatchFile).toHaveBeenCalled();
    });

    statusDirty = true;
    await act(async () => {
      capture.fire(
        INDEX,
        { mtimeMs: 2000, size: 100 },
        { mtimeMs: 1000, size: 50 },
      );
    });
    await act(async () => {
      await advanceTimersByTimeAsync(FETCH_DEBOUNCE_MS);
    });

    expect(result.current.isDirty).toBe(true);
  });

  it('flips dirty -> clean when the working tree becomes pristine', async () => {
    vi.useFakeTimers();
    let statusDirty = true;
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
      if (cmd === 'git status --porcelain')
        cb(null, statusDirty ? '?? new.txt' : '', '');
      else cb(null, 'main', '');
      return eventEmitter();
    });
    const capture = watchCapture();

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current.isDirty).toBe(true);

    await waitFor(() => {
      expect(mockWatchFile).toHaveBeenCalled();
    });

    statusDirty = false;
    await act(async () => {
      capture.fire(
        LOGS_HEAD,
        { mtimeMs: 2000, size: 100 },
        { mtimeMs: 1000, size: 50 },
      );
    });
    await act(async () => {
      await advanceTimersByTimeAsync(FETCH_DEBOUNCE_MS);
    });

    expect(result.current.isDirty).toBe(false);
  });

  it('picks up untracked-file changes via the periodic poll', async () => {
    vi.useFakeTimers();
    let statusDirty = false;
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
      if (cmd === 'git status --porcelain')
        cb(null, statusDirty ? '?? new.txt' : '', '');
      else cb(null, 'main', '');
      return eventEmitter();
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current.isDirty).toBe(false);

    // A plain working-tree edit does not touch .git metadata; the periodic poll
    // is the only signal, so it must drive the transition.
    statusDirty = true;
    await act(async () => {
      await advanceTimersByTimeAsync(GIT_WATCH_POLL_MS);
      await advanceTimersByTimeAsync(FETCH_DEBOUNCE_MS);
    });

    expect(result.current.isDirty).toBe(true);
  });

  it('coalesces refreshes while a fetch is in flight and applies results in order', async () => {
    vi.useFakeTimers();
    const statusCbs: ExecCb[] = [];
    const branchCbs: ExecCb[] = [];
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
      if (cmd === 'git status --porcelain') statusCbs.push(cb);
      else branchCbs.push(cb);
      return eventEmitter();
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });
    expect(statusCbs).toHaveLength(1);

    await waitFor(() => {
      expect(mockWatchFile).toHaveBeenCalled();
    });

    // A slow `git status` stays in flight across several poll ticks. New
    // refreshes must be queued, not started, so no second process overlaps and the
    // in-flight result is never superseded and dropped.
    await act(async () => {
      await advanceTimersByTimeAsync(GIT_WATCH_POLL_MS + FETCH_DEBOUNCE_MS);
      await advanceTimersByTimeAsync(GIT_WATCH_POLL_MS + FETCH_DEBOUNCE_MS);
    });
    expect(statusCbs).toHaveLength(1);

    // The first fetch settles; the queued refresh then runs and sees the dirty tree.
    await act(async () => {
      branchCbs[0](null, 'main', '');
      statusCbs[0](null, '', '');
    });
    expect(statusCbs).toHaveLength(2);

    await act(async () => {
      branchCbs[1](null, 'main', '');
      statusCbs[1](null, ' M f', '');
    });

    expect(result.current).toEqual({ branchName: 'main', isDirty: true });
  });

  it('keeps the branch when only the status command fails', async () => {
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
      if (cmd === 'git status --porcelain')
        cb(new Error('status error'), '', '');
      else cb(null, 'main', '');
      return eventEmitter();
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current).toEqual({ branchName: 'main', isDirty: false });
  });

  it('shows no branch when only the branch command fails', async () => {
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
      if (cmd === 'git status --porcelain') cb(null, ' M f', '');
      else cb(new Error('branch error'), '', '');
      return eventEmitter();
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    expect(result.current.branchName).toBeUndefined();
    expect(result.current.isDirty).toBe(true);
  });

  it('clears a pending debounce on unmount so no stale fetch runs', async () => {
    vi.useFakeTimers();
    let execCount = 0;
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
      execCount++;
      if (cmd === 'git status --porcelain') cb(null, '', '');
      else cb(null, 'main', '');
      return eventEmitter();
    });
    const capture = watchCapture();

    const { unmount, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    await waitFor(() => {
      expect(mockWatchFile).toHaveBeenCalled();
    });

    const baseCount = execCount;
    await act(async () => {
      capture.fire(
        INDEX,
        { mtimeMs: 2000, size: 100 },
        { mtimeMs: 1000, size: 50 },
      );
    });

    unmount();
    await act(async () => {
      await advanceTimersByTimeAsync(FETCH_DEBOUNCE_MS);
      await advanceTimersByTimeAsync(GIT_WATCH_POLL_MS);
    });

    expect(execCount).toBe(baseCount);
  });

  it('does not register watchers after unmount has disposed them', async () => {
    let resolveAccess: ((value: unknown) => void) | undefined;
    mockAccess.mockReturnValue(
      new Promise((resolve) => {
        resolveAccess = resolve;
      }),
    );

    const { unmount, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    unmount();
    mockWatchFile.mockClear();

    await act(async () => {
      resolveAccess?.(undefined);
      await Promise.resolve();
    });

    expect(mockWatchFile).not.toHaveBeenCalled();
  });

  it('commits the detached-HEAD result only after the short SHA settles', async () => {
    const branchCbs: ExecCb[] = [];
    const shortCbs: ExecCb[] = [];
    const statusCbs: ExecCb[] = [];
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
      if (cmd === 'git status --porcelain') statusCbs.push(cb);
      else if (cmd === 'git rev-parse --abbrev-ref HEAD') branchCbs.push(cb);
      else shortCbs.push(cb);
      return eventEmitter();
    });

    const { result, rerender } = renderHook(() => useGitBranchInfo(CWD));

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    // The branch lookup reports a detached HEAD and status settles clean while
    // the short-SHA command is still running: no result may apply yet.
    await act(async () => {
      branchCbs[0](null, 'HEAD', '');
      statusCbs[0](null, '', '');
      await Promise.resolve();
      rerender();
    });

    expect(result.current.branchName).toBeUndefined();

    await act(async () => {
      shortCbs[0](null, 'a1b2c3d', '');
      await Promise.resolve();
      rerender();
    });

    expect(result.current).toEqual({ branchName: 'a1b2c3d', isDirty: false });
  });

  it('ignores a stale fetch completion so it cannot clear a newer fetch', async () => {
    vi.useFakeTimers();
    const statusCbs: ExecCb[] = [];
    const branchCbs: ExecCb[] = [];
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: ExecCb) => {
      if (cmd === 'git status --porcelain') statusCbs.push(cb);
      else branchCbs.push(cb);
      return eventEmitter();
    });
    const NEW_CWD = '/other/project';

    const { result, rerender } = renderHook((cwdArg: string = CWD) =>
      useGitBranchInfo(cwdArg),
    );

    await act(async () => {
      await Promise.resolve();
      rerender();
    });

    // cwd change abandons the first fetch and starts a second one for the new dir.
    await act(async () => {
      rerender(NEW_CWD);
      await Promise.resolve();
    });
    expect(statusCbs).toHaveLength(2);

    const countBefore = statusCbs.length;
    // The old directory's fetch completes late (stale token) and must be dropped
    // without clearing the new fetch's in-flight marker.
    await act(async () => {
      statusCbs[0](null, '', '');
      branchCbs[0](null, 'old', '');
      await Promise.resolve();
    });

    // A poll tick during the still-pending new fetch queues instead of starting an
    // overlapping third fetch.
    await act(async () => {
      await advanceTimersByTimeAsync(GIT_WATCH_POLL_MS + FETCH_DEBOUNCE_MS);
    });
    expect(statusCbs).toHaveLength(countBefore);

    // The new directory's fetch then applies normally.
    await act(async () => {
      statusCbs[countBefore - 1](null, ' M f', '');
      branchCbs[countBefore - 1](null, 'new', '');
      await Promise.resolve();
    });

    expect(result.current).toEqual({ branchName: 'new', isDirty: true });
  });
});
