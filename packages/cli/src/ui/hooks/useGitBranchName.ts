/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
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
 */
const FETCH_DEBOUNCE_MS = 200;

export function useGitBranchName(cwd: string): string | undefined {
  const [branchName, setBranchName] = useState<string | undefined>(undefined);

  // Monotonic token that guards against stale exec callbacks. Each fetch
  // increments the token; when an exec callback fires, it only applies the
  // result if its token still matches the latest one. This prevents an
  // earlier-started exec (whose callback resolves after a newer one) from
  // overwriting the branch name with a stale value.
  const fetchTokenRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBranchName = useCallback(() => {
    const token = ++fetchTokenRef.current;
    exec(
      'git rev-parse --abbrev-ref HEAD',
      { cwd },
      (error, stdout, _stderr) => {
        if (token !== fetchTokenRef.current) return;
        if (error) {
          setBranchName(undefined);
          return;
        }
        const branch = stdout.toString().trim();
        if (branch && branch !== 'HEAD') {
          setBranchName(branch);
        } else {
          exec(
            'git rev-parse --short HEAD',
            { cwd },
            (error, stdout, _stderr) => {
              if (token !== fetchTokenRef.current) return;
              if (error) {
                setBranchName(undefined);
                return;
              }
              setBranchName(stdout.toString().trim());
            },
          );
        }
      },
    );
  }, [cwd]);

  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fetchBranchName();
    }, FETCH_DEBOUNCE_MS);
  }, [fetchBranchName]);

  useEffect(() => {
    fetchBranchName(); // Initial fetch

    const gitLogsHeadPath = path.join(cwd, '.git', 'logs', 'HEAD');
    let cancelled = false;

    const onGitLogsHeadChange = (curr: fs.Stats, prev: fs.Stats) => {
      if (cancelled) return;
      if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
        scheduleFetch();
      }
    };

    const setupWatcher = async () => {
      try {
        // Check if .git/logs/HEAD exists, as it might not in a new repo or orphaned head
        await fsPromises.access(gitLogsHeadPath, fs.constants.F_OK);
        if (cancelled) return;
        // fs.watchFile (stat-polling) is used instead of fs.watch because Bun has
        // confirmed-open bugs where fs.watch does not reliably deliver change events
        // when a process writes to the watched file (e.g. git appending to the reflog).
        fs.watchFile(gitLogsHeadPath, { interval: 3000 }, onGitLogsHeadChange);
      } catch {
        // Silently ignore watcher errors (e.g. permissions or file not existing),
        // similar to how exec errors are handled.
        // The branch name will simply not update automatically.
      }
    };

    void setupWatcher();

    return () => {
      cancelled = true;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      fs.unwatchFile(gitLogsHeadPath, onGitLogsHeadChange);
    };
  }, [cwd, fetchBranchName, scheduleFetch]);

  return branchName;
}
