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
 *
 * Lazy facade: the synchronous path-validation primitives and class shape
 * live here (eagerly loaded through the recording barrel), while the heavy
 * ownership, atomic-publication, transition-claim, stale-check, cleanup,
 * and filesystem implementation is dynamically imported from
 * SessionLockManager.internals.js only when an async lock operation is
 * actually called.  This keeps the cold-start import graph of the core
 * public root lightweight and prevents per-test timeouts in the agents
 * test runner (separate Bun process per file).
 *
 * Public API (source-compatible):
 * - `LockHandle` — interface
 * - `SessionLockedError` — error class
 * - `SessionLockManager.getLockPath(chatsDir, sessionId)` — sync
 * - `SessionLockManager.getLockPathFromFilePath(sessionFilePath)` — sync
 * - `SessionLockManager.acquire(chatsDir, sessionId)` — async
 * - `SessionLockManager.checkStale(lockPath)` — async
 * - `SessionLockManager.isLocked(chatsDir, sessionId)` — async
 * - `SessionLockManager.isStale(chatsDir, sessionId)` — async
 * - `SessionLockManager.removeStaleLock(chatsDir, sessionId)` — async
 * - `SessionLockManager.cleanupOrphanedLocks(chatsDir)` — async
 * - `SessionLockManager.checkStaleWithPidReuse(lockPath)` — async
 *
 * The path-validation helpers below are inlined (rather than imported from
 * janitor/sessionSafety.js) to avoid eagerly pulling node:fs/promises into
 * the facade's import graph.
 */

import * as path from 'node:path';

/** Maximum session-ID length (mirrors the safe grammar). */
const SAFE_ID_MAX_LENGTH = 256;

/**
 * Canonical safe session-ID grammar.  Inlined here so the facade does not
 * transitively import `node:fs/promises` via sessionSafety.js.
 */
const SAFE_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;

function isValidSafeSessionId(id: string): boolean {
  return SAFE_SESSION_ID_RE.test(id);
}

/** Normalize a path for comparison without touching the filesystem. */
function normalizeLexical(p: string): string {
  return path.normalize(p);
}

/**
 * Return `true` when `childPath` is a direct child file of `parentDir`.
 * A direct child has no intermediate directory between itself and the parent.
 */
function isDirectChildPath(parentDir: string, childPath: string): boolean {
  const normalizedParent = normalizeLexical(parentDir);
  const normalizedChild = normalizeLexical(childPath);
  const parentWithSep = normalizedParent + path.sep;
  if (!normalizedChild.startsWith(parentWithSep)) return false;
  const remainder = normalizedChild.slice(parentWithSep.length);
  return !remainder.includes(path.sep) && remainder.length > 0;
}

/** Assert that `lockPath` is a safe direct child of `chatsDir`. */
function assertSafeLockPath(chatsDir: string, lockPath: string): void {
  if (!isDirectChildPath(chatsDir, lockPath)) {
    throw new Error(
      `Unsafe lock path "${lockPath}" is not a direct child of "${chatsDir}"`,
    );
  }
}

/**
 * Handle returned by a successful lock acquisition.
 * Callers use `release()` to free the lock and `ownsLock()` to verify
 * on-disk ownership before destructive mutations.
 */
export interface LockHandle {
  lockPath: string;
  /** Verify this handle still owns the live lock on disk. */
  ownsLock(): Promise<boolean>;
  release(): Promise<void>;
}

export class SessionLockedError extends Error {
  constructor() {
    super('Session is in use by another process');
    this.name = 'SessionLockedError';
  }
}

/**
 * Structural type for the lazily-imported heavy implementation module.
 * Avoids inline `import()` type annotations (forbidden by the project's
 * ESLint consistent-type-imports rule) while preserving full type safety
 * for the cached dynamic-import promise.
 */
interface SessionLockInternalsModule {
  acquire(chatsDir: string, sessionId: string): Promise<LockHandle>;
  checkStale(lockPath: string): Promise<boolean>;
  isLocked(chatsDir: string, sessionId: string): Promise<boolean>;
  isStale(chatsDir: string, sessionId: string): Promise<boolean>;
  removeStaleLock(chatsDir: string, sessionId: string): Promise<void>;
  cleanupOrphanedLocks(chatsDir: string): Promise<number>;
  checkStaleWithPidReuse(lockPath: string): Promise<boolean>;
}

/** @pseudocode concurrency-lifecycle.md lines 10-134 */
export class SessionLockManager {
  // -----------------------------------------------------------------------
  // Synchronous path operations (eagerly available)
  // -----------------------------------------------------------------------

  /** @pseudocode concurrency-lifecycle.md lines 12-14 */
  static getLockPath(chatsDir: string, sessionId: string): string {
    if (
      typeof sessionId !== 'string' ||
      sessionId.length === 0 ||
      sessionId.length > SAFE_ID_MAX_LENGTH ||
      !isValidSafeSessionId(sessionId)
    ) {
      throw new Error(`Unsafe session ID rejected: "${sessionId}"`);
    }
    const lockPath = path.join(chatsDir, sessionId + '.lock');
    assertSafeLockPath(chatsDir, lockPath);
    return lockPath;
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

  // -----------------------------------------------------------------------
  // Lazy async operations (heavy implementation loaded on first call)
  // -----------------------------------------------------------------------

  /**
   * Cached promise for the dynamically imported heavy implementation.
   * The ESM module cache guarantees that concurrent first calls share the
   * same module instance.
   */
  private static internalsPromise:
    | Promise<SessionLockInternalsModule>
    | undefined;

  /** Lazily load and cache the heavy implementation module. */
  private static loadInternals(): Promise<SessionLockInternalsModule> {
    SessionLockManager.internalsPromise ??= import(
      './SessionLockManager.internals.js'
    );
    return SessionLockManager.internalsPromise;
  }

  /** @pseudocode concurrency-lifecycle.md lines 24-75 */
  static async acquire(
    chatsDir: string,
    sessionId: string,
  ): Promise<LockHandle> {
    const internals = await SessionLockManager.loadInternals();
    return internals.acquire(chatsDir, sessionId);
  }

  /** @pseudocode concurrency-lifecycle.md lines 77-96 */
  static async checkStale(lockPath: string): Promise<boolean> {
    const internals = await SessionLockManager.loadInternals();
    return internals.checkStale(lockPath);
  }

  /** @pseudocode concurrency-lifecycle.md lines 104-114 */
  static async isLocked(chatsDir: string, sessionId: string): Promise<boolean> {
    const internals = await SessionLockManager.loadInternals();
    return internals.isLocked(chatsDir, sessionId);
  }

  /** @pseudocode concurrency-lifecycle.md lines 116-124 */
  static async isStale(chatsDir: string, sessionId: string): Promise<boolean> {
    const internals = await SessionLockManager.loadInternals();
    return internals.isStale(chatsDir, sessionId);
  }

  /** @pseudocode concurrency-lifecycle.md lines 126-133 */
  static async removeStaleLock(
    chatsDir: string,
    sessionId: string,
  ): Promise<void> {
    const internals = await SessionLockManager.loadInternals();
    return internals.removeStaleLock(chatsDir, sessionId);
  }

  /** @pseudocode concurrency-lifecycle.md lines 257-282 */
  static async cleanupOrphanedLocks(chatsDir: string): Promise<number> {
    const internals = await SessionLockManager.loadInternals();
    return internals.cleanupOrphanedLocks(chatsDir);
  }

  /** @pseudocode concurrency-lifecycle.md lines 290-346 */
  static async checkStaleWithPidReuse(lockPath: string): Promise<boolean> {
    const internals = await SessionLockManager.loadInternals();
    return internals.checkStaleWithPidReuse(lockPath);
  }
}
