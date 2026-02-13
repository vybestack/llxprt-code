/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P17
 * @requirement REQ-CLN-001, REQ-CLN-002, REQ-CLN-004
 *
 * Utility functions for .jsonl session cleanup. Provides lock-aware
 * cleanup of JSONL session files using file-path-based sidecar lock
 * files (`<sessionFile>.lock`) with PID liveness checks.
 *
 * @pseudocode session-cleanup.md
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Represents a .jsonl session file entry for cleanup evaluation.
 * Similar to the CLI's SessionFileEntry but tailored for JSONL files
 * which use header-based reading instead of full JSON parse.
 */
export interface JsonlSessionFileEntry {
  /** Full filename including .jsonl extension */
  fileName: string;
  /** Absolute path to the file */
  filePath: string;
  /** File stat information */
  stat: { mtime: Date; size: number };
  /** Parsed session info from the JSONL header, or null if corrupted/unreadable */
  sessionInfo: {
    id: string;
    lastUpdated: string;
    isCurrentSession: boolean;
  } | null;
}

/**
 * Reads the first line of a .jsonl session file and extracts session info
 * from the session_start event header without reading the entire file.
 *
 * @pseudocode session-cleanup.md lines 28-29
 */
async function readSessionHeader(
  filePath: string,
): Promise<{ sessionId: string; startTime: string } | null> {
  try {
    const fd = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fd.read(buf, 0, 4096, 0);
      const firstLine = buf.toString('utf-8', 0, bytesRead).split('\n')[0];
      const parsed = JSON.parse(firstLine);
      if (parsed.type === 'session_start' && parsed.payload?.sessionId) {
        return {
          sessionId: parsed.payload.sessionId,
          startTime: parsed.payload.startTime || parsed.ts,
        };
      }
      return null;
    } finally {
      await fd.close();
    }
  } catch {
    return null;
  }
}

/**
 * Checks whether a PID is alive by sending signal 0.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and parses a lock file, returning the PID or null if unreadable.
 */
async function readLockPid(lockPath: string): Promise<number | null> {
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    const data = JSON.parse(content) as { pid: number };
    return typeof data.pid === 'number' ? data.pid : null;
  } catch {
    return null;
  }
}

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P17
 * @requirement REQ-CLN-001
 * @pseudocode session-cleanup.md lines 13-38
 *
 * Scans a chats directory for `session-*.jsonl` files and returns metadata
 * for each. Uses `readSessionHeader()` to extract session info from the
 * first line without reading the entire file.
 *
 * @param chatsDir - Path to the chats directory to scan
 * @param currentSessionId - Optional current session ID (to mark as active)
 * @returns Array of JSONL session file entries
 */
export async function getAllJsonlSessionFiles(
  chatsDir: string,
  currentSessionId?: string,
): Promise<JsonlSessionFileEntry[]> {
  let files: string[];
  try {
    files = await fs.readdir(chatsDir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const sessionFiles = files.filter(
    (f) => f.startsWith('session-') && f.endsWith('.jsonl'),
  );

  const entries: JsonlSessionFileEntry[] = [];

  for (const fileName of sessionFiles) {
    const filePath = path.join(chatsDir, fileName);
    try {
      const stat = await fs.stat(filePath);
      const header = await readSessionHeader(filePath);
      const sessionInfo = header
        ? {
            id: header.sessionId,
            lastUpdated: stat.mtime.toISOString(),
            isCurrentSession: header.sessionId === currentSessionId,
          }
        : null;
      entries.push({
        fileName,
        filePath,
        stat: { mtime: stat.mtime, size: stat.size },
        sessionInfo,
      });
    } catch {
      // Skip files that can't be stat'd or read
    }
  }

  return entries;
}

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P17
 * @requirement REQ-CLN-002
 * @pseudocode session-cleanup.md lines 50-74
 *
 * Evaluates whether a .jsonl session file should be deleted, skipped (if
 * actively locked), or have only its stale lock removed. Checks for a
 * corresponding `.lock` sidecar file and uses PID liveness to determine
 * lock staleness.
 *
 * @param entry - The JSONL session file entry to evaluate
 * @returns Disposition: `'delete'`, `'skip'`, or `'stale-lock-only'`
 */
export async function shouldDeleteSession(
  entry: JsonlSessionFileEntry,
): Promise<'delete' | 'skip' | 'stale-lock-only'> {
  const lockPath = entry.filePath + '.lock';

  let lockExists: boolean;
  try {
    await fs.access(lockPath);
    lockExists = true;
  } catch {
    lockExists = false;
  }

  if (!lockExists) {
    return 'delete';
  }

  const pid = await readLockPid(lockPath);
  if (pid !== null && isPidAlive(pid)) {
    return 'skip';
  }

  return 'stale-lock-only';
}

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P17
 * @requirement REQ-CLN-004
 * @pseudocode session-cleanup.md lines 85-130
 *
 * Cleans up stale and orphaned `.lock` files in the chats directory.
 * Orphaned locks (no corresponding `.jsonl` file) are always removed.
 * Stale locks (PID no longer running) are removed but the data file is
 * left for normal retention policy evaluation.
 *
 * @param chatsDir - Path to the chats directory to scan for lock files
 * @returns Number of lock files cleaned up
 */
export async function cleanupStaleLocks(chatsDir: string): Promise<number> {
  let files: string[];
  try {
    files = await fs.readdir(chatsDir);
  } catch {
    return 0;
  }

  const lockFiles = files.filter((f) => f.endsWith('.lock'));
  let cleaned = 0;

  for (const lockFileName of lockFiles) {
    const lockPath = path.join(chatsDir, lockFileName);

    const dataFileName = lockFileName.replace(/\.lock$/, '');
    const dataPath = path.join(chatsDir, dataFileName);

    let dataExists: boolean;
    try {
      await fs.access(dataPath);
      dataExists = true;
    } catch {
      dataExists = false;
    }

    if (!dataExists) {
      try {
        await fs.unlink(lockPath);
        cleaned++;
      } catch {
        // Best-effort
      }
      continue;
    }

    const pid = await readLockPid(lockPath);
    const isStale = pid === null || !isPidAlive(pid);

    if (isStale) {
      try {
        await fs.unlink(lockPath);
        cleaned++;
      } catch {
        // Best-effort
      }
    }
  }

  return cleaned;
}
