/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan project-plans/issue3238.md
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { exec } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'path';

/**
 * Debounce window for coalescing rapid reflog writes caused by compound
 * git commands (e.g. `git checkout main && git fetch && git pull`). Without
 * this, each write to `.git/logs/HEAD` spawns an overlapping `exec()`,
 * increasing the chance that a stale result clobbers the latest branch name.
 *
 * 200ms was chosen empirically: compound git commands (checkout + fetch +
 * pull) typically write the reflog 2-3 times within ~50ms. A 200ms window
 * safely covers the burst while keeping the visible latency below a typical
 * user's perception threshold. It is also well under the 3000ms fs.watchFile
 * polling interval, so it never delays a legitimate single-command update
 * beyond what the polling itself already imposes.
 */
const FETCH_DEBOUNCE_MS = 200;

/**
 * Poll interval for the working-tree status refresh and for the fs.watchFile
 * stat polls. Plain edits to tracked files and untracked file creation/removal do
 * not touch `.git/logs/HEAD` or `.git/index`, so a regular debounced status
 * refresh is the only reliable signal for those transitions.
 */
const GIT_WATCH_POLL_MS = 3000;

/** Exposed for tests so timing assertions track the production constant. */
export { FETCH_DEBOUNCE_MS, GIT_WATCH_POLL_MS };

export interface GitBranchInfo {
  branchName: string | undefined;
  /**
   * True when `git status --porcelain` reports any change in `cwd`. Tracked
   * modifications, staged changes, and untracked files all count as dirty,
   * matching the shell-prompt convention. Errors (non-git directory) are not
   * dirty.
   */
  isDirty: boolean;
}

/** The result of one full refresh tick, committed as a single tuple. */
export interface GitInfoResult {
  branchName: string | undefined;
  isDirty: boolean;
}

/**
 * Runs both git queries for one refresh tick and reports the result once both
 * commands have settled. The branch and status fields are computed independently:
 * a branch failure keeps showing no branch, a status failure is never dirty. A
 * detached HEAD falls back to the short SHA.
 */
function fetchGitInfo(
  cwd: string,
  onResult: (result: GitInfoResult) => void,
): void {
  let branchName: string | undefined;
  let isDirty = false;
  let branchFailed = false;
  let statusFailed = false;
  let branchSettled = false;
  let statusSettled = false;

  const settle = () => {
    if (!branchSettled || !statusSettled) return;
    onResult({
      branchName: branchFailed ? undefined : branchName,
      isDirty: statusFailed ? false : isDirty,
    });
  };

  exec('git rev-parse --abbrev-ref HEAD', { cwd }, (error, stdout) => {
    if (error) {
      branchFailed = true;
      branchSettled = true;
      settle();
      return;
    }
    const branch = stdout.toString().trim();
    if (branch && branch !== 'HEAD') {
      branchName = branch;
      branchSettled = true;
      settle();
      return;
    }
    exec('git rev-parse --short HEAD', { cwd }, (error, stdout) => {
      if (error) branchFailed = true;
      else branchName = stdout.toString().trim();
      branchSettled = true;
      settle();
    });
  });
  exec('git status --porcelain', { cwd }, (error, stdout) => {
    statusSettled = true;
    if (error) statusFailed = true;
    else isDirty = stdout.toString().trim() !== '';
    settle();
  });
}

export function useGitBranchInfo(cwd: string): GitBranchInfo {
  const [branchName, setBranchName] = useState<string | undefined>(undefined);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Monotonic token that guards against applying a result that belongs to an
  // older refresh tick. Fetches never overlap: if a fetch is in flight while a
  // new refresh is requested (watcher event or poll tick), the request is queued
  // instead, so a slow `git status` cannot be perpetually superseded and dropped.
  const fetchTokenRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const inFlightRef = useRef(false);
  const needsRefreshRef = useRef(false);

  const applyResult = useCallback((result: GitInfoResult) => {
    setBranchName(result.branchName);
    setIsDirty(result.isDirty);
  }, []);

  // Indirect call so a queued refresh can start a new fetch from within the
  // completion callback without capturing a stale closure.
  const fetchBranchInfoRef = useRef<() => void>(() => {});

  const fetchBranchInfo = useCallback(() => {
    if (cancelledRef.current) return;
    if (inFlightRef.current) {
      needsRefreshRef.current = true;
      return;
    }
    inFlightRef.current = true;
    const token = ++fetchTokenRef.current;
    fetchGitInfo(cwd, (result) => {
      if (cancelledRef.current || token !== fetchTokenRef.current) return;
      inFlightRef.current = false;
      applyResult(result);
      if (needsRefreshRef.current) {
        needsRefreshRef.current = false;
        fetchBranchInfoRef.current();
      }
    });
  }, [cwd, applyResult]);

  useEffect(() => {
    fetchBranchInfoRef.current = fetchBranchInfo;
  });

  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fetchBranchInfo();
    }, FETCH_DEBOUNCE_MS);
  }, [fetchBranchInfo]);

  useEffect(() => {
    // Flags are reset before the first fetch so a prior `cwd`'s abandoned
    // in-flight fetch cannot suppress the new directory's refresh. The fetch
    // token guard drops that abandoned fetch's late result.
    cancelledRef.current = false;
    inFlightRef.current = false;
    needsRefreshRef.current = false;
    fetchBranchInfo(); // Initial fetch

    const unwatch = watchGitMetadata(cwd, () => {
      if (!cancelledRef.current) scheduleFetch();
    });

    // Debounced working-tree poll. `.git/logs/HEAD` and `.git/index` only
    // change on branch switches, stages, commits, and checkouts, so plain edits
    // to tracked files and untracked file creation/removal need a periodic status
    // refresh to keep the dirty star honest. Reuses the same debounce so a poll
    // that races a watcher event collapses into a single fetch.
    const statusPoll = setInterval(() => {
      if (!cancelledRef.current) scheduleFetch();
    }, GIT_WATCH_POLL_MS);

    return () => {
      cancelledRef.current = true;
      clearInterval(statusPoll);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      unwatch();
    };
  }, [cwd, fetchBranchInfo, scheduleFetch]);

  return { branchName, isDirty };
}

/**
 * Watches `.git/logs/HEAD` (reflog) and `.git/index` for stat changes and
 * calls `onChange` when either changes. Returns a cleanup that unwatches both.
 * fs.watchFile (stat-polling) is used instead of fs.watch because Bun has
 * confirmed-open bugs where fs.watch does not reliably deliver change events when a
 * process writes to the watched file (e.g. git appending to the reflog).
 */
function watchGitMetadata(cwd: string, onChange: () => void): () => void {
  const gitLogsHeadPath = path.join(cwd, '.git', 'logs', 'HEAD');
  const gitIndexPath = path.join(cwd, '.git', 'index');
  let disposed = false;

  const onGitChange = (curr: fs.Stats, prev: fs.Stats) => {
    if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
      onChange();
    }
  };

  const register = (file: string) => {
    void (async () => {
      try {
        await fsPromises.access(file, fs.constants.F_OK);
      } catch {
        // Missing or inaccessible metadata is handled by the periodic poll.
        return;
      }
      if (disposed) return;
      fs.watchFile(file, { interval: GIT_WATCH_POLL_MS }, onGitChange);
    })();
  };

  register(gitLogsHeadPath);
  register(gitIndexPath);

  return () => {
    disposed = true;
    fs.unwatchFile(gitLogsHeadPath, onGitChange);
    fs.unwatchFile(gitIndexPath, onGitChange);
  };
}
