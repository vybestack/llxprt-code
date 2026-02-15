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
 * @plan PLAN-20260211-SESSIONRECORDING.P11
 * @requirement REQ-CON-001, REQ-CON-002, REQ-CON-003, REQ-CON-004, REQ-CON-005
 * @pseudocode concurrency-lifecycle.md lines 10-134, 257-282, 290-346
 *
 * Advisory lock manager for session files. Uses PID-based lock files
 * to prevent concurrent writes to the same session. Lock path convention:
 * `<chatsDir>/<sessionId>.lock` — session-ID-based, independent of JSONL
 * file materialization state.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Handle returned by a successful lock acquisition.
 * Callers use `release()` to free the lock.
 */
export interface LockHandle {
  lockPath: string;
  release(): Promise<void>;
}

/** @pseudocode concurrency-lifecycle.md lines 10-134 */
export class SessionLockManager {
  /** @pseudocode concurrency-lifecycle.md lines 12-14 */
  static getLockPath(chatsDir: string, sessionId: string): string {
    return path.join(chatsDir, sessionId + '.lock');
  }

  /** @pseudocode concurrency-lifecycle.md lines 16-22 */
  static getLockPathFromFilePath(sessionFilePath: string): string {
    const dir = path.dirname(sessionFilePath);
    const basename = path.basename(sessionFilePath);
    const match = basename.match(/^session-(.+)\.jsonl$/);
    if (!match) {
      throw new Error(
        'Cannot extract session ID from path: ' + sessionFilePath,
      );
    }
    return SessionLockManager.getLockPath(dir, match[1]);
  }

  /** @pseudocode concurrency-lifecycle.md lines 24-75 */
  static async acquire(
    chatsDir: string,
    sessionId: string,
  ): Promise<LockHandle> {
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
    const pid = process.pid;
    const lockContent = JSON.stringify({
      pid,
      timestamp: new Date().toISOString(),
      sessionId,
    });

    try {
      await fs.writeFile(lockPath, lockContent, { flag: 'wx' });
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        const isStale = await SessionLockManager.checkStale(lockPath);
        if (isStale) {
          try {
            await fs.unlink(lockPath);
          } catch (unlinkErr: unknown) {
            if ((unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw unlinkErr;
            }
          }
          try {
            await fs.writeFile(lockPath, lockContent, { flag: 'wx' });
          } catch {
            throw new Error('Session is in use by another process');
          }
        } else {
          throw new Error('Session is in use by another process');
        }
      } else if (code === 'ENOENT') {
        await fs.mkdir(path.dirname(lockPath), { recursive: true });
        await fs.writeFile(lockPath, lockContent, { flag: 'wx' });
      } else {
        throw error;
      }
    }

    let released = false;
    return {
      lockPath,
      release: async (): Promise<void> => {
        if (released) return;
        released = true;
        try {
          await fs.unlink(lockPath);
        } catch {
          // Best-effort release
        }
      },
    };
  }

  /** @pseudocode concurrency-lifecycle.md lines 77-96 */
  static async checkStale(lockPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(lockPath, 'utf-8');
      const lockData = JSON.parse(content) as { pid: number };
      const lockPid = lockData.pid;

      try {
        process.kill(lockPid, 0);
        return false;
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EPERM') {
          return false;
        }
        return true;
      }
    } catch {
      return true;
    }
  }

  /** @pseudocode concurrency-lifecycle.md lines 104-114 */
  static async isLocked(chatsDir: string, sessionId: string): Promise<boolean> {
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
    try {
      await fs.access(lockPath);
      const stale = await SessionLockManager.checkStale(lockPath);
      return !stale;
    } catch {
      return false;
    }
  }

  /** @pseudocode concurrency-lifecycle.md lines 116-124 */
  static async isStale(chatsDir: string, sessionId: string): Promise<boolean> {
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
    try {
      await fs.access(lockPath);
      return await SessionLockManager.checkStale(lockPath);
    } catch {
      return false;
    }
  }

  /** @pseudocode concurrency-lifecycle.md lines 126-133 */
  static async removeStaleLock(
    chatsDir: string,
    sessionId: string,
  ): Promise<void> {
    const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
    try {
      await fs.unlink(lockPath);
    } catch {
      // Best-effort
    }
  }

  /** @pseudocode concurrency-lifecycle.md lines 257-282 */
  static async cleanupOrphanedLocks(chatsDir: string): Promise<void> {
    let files: string[];
    try {
      files = await fs.readdir(chatsDir);
    } catch {
      return;
    }
    const lockFiles = files.filter((f) => f.endsWith('.lock'));

    for (const lockFile of lockFiles) {
      const lockPath = path.join(chatsDir, lockFile);
      const isStale = await SessionLockManager.checkStale(lockPath);

      if (!isStale) {
        continue;
      }

      try {
        await fs.unlink(lockPath);
      } catch {
        // Best-effort
      }
    }
  }

  /** @pseudocode concurrency-lifecycle.md lines 290-346 */
  static async checkStaleWithPidReuse(lockPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(lockPath, 'utf-8');
      const lockData = JSON.parse(content) as {
        pid: number;
        timestamp: string;
      };
      const lockPid = lockData.pid;

      let pidAlive = false;
      try {
        process.kill(lockPid, 0);
        pidAlive = true;
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EPERM') {
          pidAlive = true;
        } else {
          return true;
        }
      }

      if (pidAlive && lockData.timestamp) {
        const lockAge = Date.now() - new Date(lockData.timestamp).getTime();
        const maxAge = 48 * 60 * 60 * 1000;
        if (lockAge > maxAge) {
          return true;
        }
      }

      return false;
    } catch {
      return true;
    }
  }
}
