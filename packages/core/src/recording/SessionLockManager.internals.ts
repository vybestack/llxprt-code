/**
 * Copyright 2026 Vybestack LLC
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
 * Heavy implementation for the advisory session-lock manager.
 *
 * This module is NOT barrel-exported.  It is loaded lazily via dynamic
 * `import()` from {@link SessionLockManager.ts} (the eager facade) only when
 * an async lock operation is actually called.  Keeping the hardened
 * ownership, atomic-publication, transition-claim, stale-check, cleanup, and
 * filesystem code out of the eager import graph prevents the cold-start
 * regression where importing the core public root caused per-test timeouts
 * in the agents test runner (separate Bun process per file).
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P11
 * @requirement REQ-CON-001, REQ-CON-002, REQ-CON-003, REQ-CON-004, REQ-CON-005
 * @pseudocode concurrency-lifecycle.md lines 10-134, 257-282, 290-346
 *
 * Hardened ownership safety (Item 3):
 * - Random backward-compatible owner tokens identify each acquisition.
 * - Locks are published atomically via temp-file + hard-link so no partial
 *   lock content can ever appear at the lock path.
 * - Unreadable/recent lock files are treated as **busy**, not instantly stale.
 * - Stale takeover re-reads the lock before unlinking to avoid removing a
 *   replacement live lock; the final create uses atomic exclusive creation.
 * - Release unlinks only when the on-disk owner token still matches.
 * - A per-session filesystem transition guard serializes ALL pathname
 *   mutations — acquire, stale takeover, removeStaleLock, orphan cleanup,
 *   and release — so a stale checker can never unlink a replacement live
 *   lock.  The guard is an **atomic hard-link claim** tied to the current
 *   lock inode: `link(lockPath, guardPath)` succeeds for exactly one
 *   contender (EEXIST means another owns it).  A crashed claim is safe to
 *   remove because unlinking a hard link only decrements a link count and
 *   cannot remove/replace the live lock.  Every mutator verifies that the
 *   guard and lock path still share the same inode before touching
 *   lockPath.  Guard crash recovery preserves the live-PID/EPERM and
 *   48-hour PID-reuse semantics.
 * - Destructive janitor ownership is verified through the token-bound
 *   {@link LockHandle.ownsLock} immediately before mutation.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  isValidSafeSessionId,
  isDirectChildPath,
} from './janitor/sessionSafety.js';
import {
  SessionLockManager,
  SessionLockedError,
  type LockHandle,
} from './SessionLockManager.js';

/** Fixed age bound for PID-reuse staleness (48 hours). */
const LOCK_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** Suffix for the per-session transition guard file. */
const TRANSITION_GUARD_SUFFIX = '.tguard';

/** Suffix for orphaned temp publication artifacts. */
const LOCK_TEMP_SUFFIX = '.locktmp';

/**
 * Exact grammar for stale lock temp publication artifacts.
 * Matches `<safeSessionId>.lock.<uuid>.locktmp` where the uuid is a v4 UUID.
 * This is deliberately strict so unknown files are never deleted.
 */
const LOCK_TEMP_GRAMMAR =
  /^[A-Za-z0-9_-]+\.lock\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.locktmp$/;

/** Conservative age threshold for reclaiming orphaned lock temp files. */
const STALE_LOCK_TEMP_AGE_MS = 5 * 60 * 1000;

/**
 * Maps lock path to owner token for all currently held locks in this process.
 * Module-global: a single Map instance shared across all calls within the
 * same ESM module identity (guaranteed by the dynamic import cache).
 */
const ownedLockPaths = new Map<string, string>();

/** @pseudocode concurrency-lifecycle.md lines 24-75 */
export async function acquire(
  chatsDir: string,
  sessionId: string,
): Promise<LockHandle> {
  const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
  if (ownedLockPaths.has(lockPath)) {
    throw new SessionLockedError();
  }
  const ownerToken = crypto.randomUUID();
  const lockTimestamp = new Date().toISOString();
  const lockContent = JSON.stringify({
    pid: process.pid,
    timestamp: lockTimestamp,
    sessionId,
    ownerToken,
  });

  // Try atomic exclusive creation first.
  const created = await tryCreateLock(lockPath, lockContent);
  if (!created) {
    // Lock exists — attempt conservative stale takeover.
    const takenOver = await tryStaleTakeover(lockPath, lockContent);
    if (!takenOver) {
      throw new SessionLockedError();
    }
  }

  ownedLockPaths.set(lockPath, ownerToken);
  let released = false;
  return {
    lockPath,
    ownsLock: async (): Promise<boolean> =>
      checkOwnership(lockPath, ownerToken),
    release: async (): Promise<void> => {
      if (released) return;
      released = true;
      ownedLockPaths.delete(lockPath);
      // Ownership-checked release: only unlink when the on-disk lock still
      // carries our owner token.  This prevents removing a lock that another
      // process acquired or replaced after our original acquisition.
      await releaseIfOwned(lockPath, ownerToken);
    },
  };
}

/**
 * Write the complete lock payload to a temp file (O_EXCL) and sync it.
 * Returns true on success, false for a retryable collision (EEXIST) or a
 * missing parent directory (ENOENT).  All other errors (ENOSPC, EACCES,
 * EROFS, EDQUOT, …) are rethrown so the caller does not mistake them for
 * "lock already exists".
 */
async function writeTempLockFile(
  tempPath: string,
  lockContent: string,
): Promise<boolean> {
  let fd: fs.FileHandle | undefined;
  try {
    fd = await fs.open(tempPath, 'wx');
    await fd.writeFile(lockContent, 'utf-8');
    await fd.sync();
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    // EEXIST (uuid collision) or ENOENT (parent dir missing) -> retryable.
    if (code === 'EEXIST' || code === 'ENOENT') return false;
    throw error; // Propagate genuine I/O failures.
  } finally {
    await fd?.close().catch(() => {});
  }
}

/**
 * Atomically link the temp file to the lock path (exclusive creation).
 * Cleans up the temp file regardless of outcome.
 *
 * Returns `true` on success, `false` **only** for `EEXIST` (the lock
 * already exists).  Any other error (ENOSPC, EACCES, EROFS, EDQUOT, …) is
 * rethrown so the caller cannot mistake a transient I/O failure for "lock
 * busy" and proceed to stale-takeover.
 */
async function publishTempToLock(
  tempPath: string,
  lockPath: string,
): Promise<boolean> {
  try {
    await fs.link(tempPath, lockPath);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return false;
  } finally {
    await safeUnlink(tempPath);
  }
}

/**
 * Atomically publish a complete lock file using a temp file + hard link.
 *
 * The temp file is fully written and synced before linking, so the lock
 * path only ever contains a complete payload — never a partial write.
 * Returns `true` on success, `false` if the lock already exists (EEXIST).
 */
async function tryCreateLock(
  lockPath: string,
  lockContent: string,
): Promise<boolean> {
  const tempPath = lockPath + '.' + crypto.randomUUID() + '.locktmp';

  let written = await writeTempLockFile(tempPath, lockContent);
  if (!written) {
    // Parent dir may not exist — create it and retry once.
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    written = await writeTempLockFile(tempPath, lockContent);
  }
  if (!written) {
    await safeUnlink(tempPath);
    return false;
  }

  // Atomically link the temp file to the lock path.
  return publishTempToLock(tempPath, lockPath);
}

/**
 * Attempt to take over a stale lock under the transition guard.  The guard
 * serializes this mutation so a concurrent process cannot replace the lock
 * between the stale determination and the unlink.
 */
async function tryStaleTakeover(
  lockPath: string,
  lockContent: string,
): Promise<boolean> {
  if (!(await acquireTransitionGuard(lockPath))) {
    return false; // Another process is transitioning — busy.
  }
  try {
    // Read current content for ownership verification.
    let originalContent: string;
    try {
      originalContent = await fs.readFile(lockPath, 'utf-8');
    } catch {
      // Can't read — try to create fresh.
      return await tryCreateLock(lockPath, lockContent);
    }

    const isStale = await checkStaleWithPidReuse(lockPath);
    if (!isStale) {
      return false;
    }

    // Re-read to verify the lock hasn't been replaced between the stale
    // determination and the unlink.  If the content changed, another process
    // owns this lock now — skip.
    try {
      const currentContent = await fs.readFile(lockPath, 'utf-8');
      if (currentContent !== originalContent) {
        return false;
      }
    } catch {
      // Vanished between reads — try to create fresh.
      return await tryCreateLock(lockPath, lockContent);
    }

    // Verify the transition claim still identifies the same inode as
    // the lock before unlinking.  If the lock was replaced by another
    // process, the inodes will differ and we must skip.
    if (!(await verifyTransitionClaim(lockPath))) {
      return false;
    }

    // Unlink the stale lock.
    try {
      await fs.unlink(lockPath);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') return false;
    }

    // Atomically create our lock.  If another process won the race between
    // our unlink and this create, the link fails with EEXIST and we lose.
    return await tryCreateLock(lockPath, lockContent);
  } finally {
    await releaseTransitionGuard(lockPath);
  }
}

/** @pseudocode concurrency-lifecycle.md lines 77-96 */
export async function checkStale(lockPath: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(lockPath, 'utf-8');
  } catch {
    // Unreadable lock — treat as busy, not instantly stale (Item 3).
    return false;
  }

  let lockData: { pid?: unknown };
  try {
    lockData = JSON.parse(content);
  } catch {
    // Corrupt JSON — treat as busy, not instantly stale (Item 3).
    return false;
  }

  // Validate PID as a positive safe integer before process.kill so that an
  // undefined/invalid pid is not coerced to signal our own process group.
  if (
    typeof lockData.pid !== 'number' ||
    !Number.isSafeInteger(lockData.pid) ||
    lockData.pid <= 0
  ) {
    return false;
  }
  const lockPid = lockData.pid;

  if (lockPid === process.pid && ownedLockPaths.has(lockPath)) {
    return false;
  }
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
}

/** @pseudocode concurrency-lifecycle.md lines 104-114 */
export async function isLocked(
  chatsDir: string,
  sessionId: string,
): Promise<boolean> {
  const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
  try {
    await fs.access(lockPath);
    const stale = await checkStale(lockPath);
    return !stale;
  } catch {
    return false;
  }
}

/** @pseudocode concurrency-lifecycle.md lines 116-124 */
export async function isStale(
  chatsDir: string,
  sessionId: string,
): Promise<boolean> {
  const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
  try {
    await fs.access(lockPath);
    return await checkStale(lockPath);
  } catch {
    return false;
  }
}

/** @pseudocode concurrency-lifecycle.md lines 126-133 */
export async function removeStaleLock(
  chatsDir: string,
  sessionId: string,
): Promise<void> {
  const lockPath = SessionLockManager.getLockPath(chatsDir, sessionId);
  // Route through the hardened removal path that re-reads the lock content
  // before unlinking and holds the transition guard (AC-8 / Item 3).
  await tryRemoveStaleLock(lockPath, chatsDir);
}

/** @pseudocode concurrency-lifecycle.md lines 257-282 */
export async function cleanupOrphanedLocks(chatsDir: string): Promise<number> {
  let files: string[];
  try {
    files = await fs.readdir(chatsDir);
  } catch {
    return 0;
  }
  const lockFiles = files.filter(
    (f) => f.endsWith('.lock') && f.length > '.lock'.length,
  );
  let removed = 0;

  for (const lockFile of lockFiles) {
    const lockPath = path.join(chatsDir, lockFile);
    if (await tryRemoveStaleLock(lockPath, chatsDir)) {
      removed++;
    }
  }

  // Also reclaim orphaned stale transition guards left by crashed processes.
  // Validate exact grammar, direct-child, and regular non-symlink lstat
  // before any stale check or unlink — consistent with lock temp cleanup.
  const guardFiles = files.filter((f) => f.endsWith(TRANSITION_GUARD_SUFFIX));
  for (const guardFile of guardFiles) {
    await cleanupStaleGuard(chatsDir, guardFile);
  }

  // Clean up orphaned temp publication artifacts from crashed lock
  // acquisitions.  Only files matching the exact generated grammar
  // (`<safe-id>.lock.<uuid>.locktmp`) that are regular non-symlink direct
  // children and older than the conservative age threshold are removed.
  const tempFiles = files.filter((f) => f.endsWith(LOCK_TEMP_SUFFIX));
  for (const tempFile of tempFiles) {
    await cleanupStaleLockTemp(chatsDir, tempFile);
  }

  return removed;
}

/**
 * Remove a single lock file only when:
 * 1. The filename matches the safe lock grammar (`<safeSessionId>.lock`).
 * 2. The lock is stale.
 * 3. Its on-disk content has not changed between stale determination and
 *    unlink (hardened against ownership replacement, Item 3/AC-8).
 * 4. The payload's sessionId matches the filename.
 *
 * Returns true when removed.
 */
async function tryRemoveStaleLock(
  lockPath: string,
  chatsDir: string,
): Promise<boolean> {
  // Validate the lock path is a safe direct child of chatsDir.
  if (!isDirectChildPath(chatsDir, lockPath)) return false;

  // Validate the lock filename matches the safe grammar.
  const basename = path.basename(lockPath);
  const lockIdMatch = basename.match(/^(.+)\.lock$/);
  if (!lockIdMatch) return false;
  const lockSessionId = lockIdMatch[1];
  if (!isValidSafeSessionId(lockSessionId)) return false;

  // Acquire the transition guard to serialize this mutation.
  if (!(await acquireTransitionGuard(lockPath))) {
    return false; // Another process is transitioning — busy.
  }
  try {
    // Read content for ownership verification before stale determination.
    let originalContent: string;
    try {
      originalContent = await fs.readFile(lockPath, 'utf-8');
    } catch {
      return false; // Can't read — treat as busy, skip.
    }

    // Validate payload identity: the payload sessionId should match the
    // filename's sessionId.
    let payloadSessionId: string | undefined;
    try {
      const parsed = JSON.parse(originalContent) as Record<string, unknown>;
      if (
        typeof parsed.sessionId === 'string' &&
        isValidSafeSessionId(parsed.sessionId)
      ) {
        payloadSessionId = parsed.sessionId;
      }
    } catch {
      // Corrupt payload — skip (busy, not stale).
      return false;
    }
    if (payloadSessionId !== undefined && payloadSessionId !== lockSessionId) {
      return false; // Filename/payload identity mismatch — skip.
    }

    const isStale = await checkStaleWithPidReuse(lockPath);
    if (!isStale) {
      return false;
    }

    // Re-read to verify the lock hasn't been replaced between stale
    // determination and unlink.
    try {
      const currentContent = await fs.readFile(lockPath, 'utf-8');
      if (currentContent !== originalContent) {
        return false;
      }
    } catch {
      return false; // Vanished — benign.
    }

    // Verify the transition claim still identifies the same inode as
    // the lock before unlinking.
    if (!(await verifyTransitionClaim(lockPath))) {
      return false;
    }

    try {
      await fs.unlink(lockPath);
      return true;
    } catch {
      return false; // Best-effort.
    }
  } finally {
    await releaseTransitionGuard(lockPath);
  }
}

/** @pseudocode concurrency-lifecycle.md lines 290-346 */
export async function checkStaleWithPidReuse(
  lockPath: string,
): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(lockPath, 'utf-8');
  } catch {
    // Unreadable — use file mtime as the fallback age bound (Item 3).
    return isOlderThanBound(lockPath);
  }

  let lockData: { pid?: unknown; timestamp?: unknown };
  try {
    lockData = JSON.parse(content);
  } catch {
    // Corrupt JSON — use file mtime as the fallback age bound (Item 3).
    return isOlderThanBound(lockPath);
  }

  // Validate PID as a positive safe integer before process.kill so that an
  // undefined/invalid pid is not coerced to signal our own process group.
  if (
    typeof lockData.pid !== 'number' ||
    !Number.isSafeInteger(lockData.pid) ||
    lockData.pid <= 0
  ) {
    // Malformed PID — fall back to age-based stale detection.
    return isOlderThanBound(lockPath);
  }
  const lockPid = lockData.pid;

  try {
    process.kill(lockPid, 0);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM') {
      return true; // ESRCH -> dead PID -> stale.
    }
  }

  // Validate the timestamp as a finite date.  A missing or malformed
  // timestamp would make `Date.now() - NaN` evaluate to NaN, and
  // `NaN > LOCK_MAX_AGE_MS` is always false — making the lock immortal.
  // Fall back to the mtime-based age bound instead (consistent with the
  // corrupt-JSON and invalid-PID paths above).
  const timestampMs = new Date(
    typeof lockData.timestamp === 'string' ? lockData.timestamp : '',
  ).getTime();
  if (!Number.isFinite(timestampMs)) {
    return isOlderThanBound(lockPath);
  }
  return Date.now() - timestampMs > LOCK_MAX_AGE_MS;
}

/**
 * Check whether the file at `filePath` is older than the PID-reuse age
 * bound, using `stat` mtime.  Used as the conservative fallback for
 * unreadable/corrupt locks so they are eventually reclaimable without
 * being instantly treated as stale.
 */
async function isOlderThanBound(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return Date.now() - stat.mtimeMs > LOCK_MAX_AGE_MS;
  } catch {
    return false; // Can't stat — conservatively not stale.
  }
}

/**
 * Check whether the on-disk lock at `lockPath` still carries `ownerToken`.
 */
async function checkOwnership(
  lockPath: string,
  ownerToken: string,
): Promise<boolean> {
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;
    return data.ownerToken === ownerToken;
  } catch {
    return false;
  }
}

/**
 * Release the lock by unlinking only when the on-disk owner token matches.
 * Holds the transition guard so a concurrent takeover cannot replace the
 * lock between the ownership check and the unlink.
 */
async function releaseIfOwned(
  lockPath: string,
  ownerToken: string,
): Promise<void> {
  if (!(await acquireTransitionGuard(lockPath))) {
    return; // Can't acquire guard — best-effort, leave lock in place.
  }
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;
    if (data.ownerToken !== ownerToken) {
      // We don't own this lock anymore — don't remove it.
      return;
    }
    // Verify the transition claim still identifies the same inode as
    // the lock before unlinking.
    if (!(await verifyTransitionClaim(lockPath))) {
      return;
    }
    await fs.unlink(lockPath);
  } catch {
    // Best-effort release.
  } finally {
    await releaseTransitionGuard(lockPath);
  }
}

// -----------------------------------------------------------------------
// Per-session transition guard (root safety fix 1)
// -----------------------------------------------------------------------

/** Return the guard path for a given lock path. */
function getGuardPath(lockPath: string): string {
  return lockPath + TRANSITION_GUARD_SUFFIX;
}

/**
 * Acquire the per-session transition claim by atomically hard-linking
 * the **current lock inode** to the guard path.
 *
 * Unlike a separate-owner guard (which has its own PID and suffers a
 * check-stale-then-unlink race), the hard-link claim is tied to the lock
 * inode itself:
 *
 * - `link(lockPath, guardPath)` succeeds for exactly one contender; others
 *   get EEXIST and fail/skip.
 * - ENOENT means the lock does not exist — fresh creates use exclusive
 *   link/create so no claim is needed.
 * - A crashed claim is a hard link, so removing it only decrements a link
 *   count and **cannot remove or replace the live lock** at lockPath.
 * - If claim recovery races, every mutator must re-establish and validate
 *   its own claim via {@link verifyTransitionClaim} before touching
 *   lockPath.
 *
 * Returns true when the claim is held (or no lock exists to guard).
 */
async function acquireTransitionGuard(lockPath: string): Promise<boolean> {
  const guardPath = getGuardPath(lockPath);

  // Atomically claim the lock inode.
  try {
    await fs.link(lockPath, guardPath);
    return true; // Claimed the lock inode.
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // Lock does not exist — no inode to claim.
      return true;
    }
    if (code !== 'EEXIST') return false;
  }

  // Another transition owns the claim. Attempt conservative recovery.
  return tryReclaimGuard(lockPath);
}

/**
 * Conservatively reclaim a stale transition claim.
 *
 * The guard is a hard link to a lock inode, so its content IS the lock
 * content.  When the lock content indicates staleness (dead PID or past
 * the 48-hour PID-reuse bound), the claim owner has crashed and the guard
 * is safe to remove — it only decrements a link count.
 */
async function tryReclaimGuard(lockPath: string): Promise<boolean> {
  const guardPath = getGuardPath(lockPath);

  if (!(await checkStaleWithPidReuse(guardPath))) {
    return false; // Guard content indicates a live transition owner.
  }

  try {
    await fs.unlink(guardPath);
  } catch {
    return false; // Can't reclaim — busy.
  }

  // Retry the claim. The lock inode may have changed during recovery.
  try {
    await fs.link(lockPath, guardPath);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true; // Lock vanished — no claim needed.
    return false;
  }
}

/**
 * Verify that the transition guard and the lock path still identify the
 * **same inode**.  Every mutator must call this before unlinking lockPath
 * to ensure the lock has not been replaced by another process since the
 * claim was acquired.
 */
async function verifyTransitionClaim(lockPath: string): Promise<boolean> {
  const guardPath = getGuardPath(lockPath);
  try {
    const lockStat = await fs.stat(lockPath);
    const guardStat = await fs.stat(guardPath);
    return lockStat.dev === guardStat.dev && lockStat.ino === guardStat.ino;
  } catch {
    return false;
  }
}

/** Release the transition guard (best-effort). */
async function releaseTransitionGuard(lockPath: string): Promise<void> {
  await safeUnlink(getGuardPath(lockPath));
}

/** Best-effort unlink that swallows errors. */
async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // Best-effort.
  }
}

/**
 * Safely clean up a single stale lock temp publication artifact.  Only
 * removes the file when it matches the exact generated grammar, is a
 * regular non-symlink direct child of chatsDir, and is older than the
 * conservative age threshold.  Unknown files are never deleted.
 */
async function cleanupStaleLockTemp(
  chatsDir: string,
  fileName: string,
): Promise<void> {
  if (!LOCK_TEMP_GRAMMAR.test(fileName)) return;
  const filePath = path.join(chatsDir, fileName);
  if (!isDirectChildPath(chatsDir, filePath)) return;
  try {
    const lstat = await fs.lstat(filePath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) return;
    if (Date.now() - lstat.mtimeMs <= STALE_LOCK_TEMP_AGE_MS) return;
  } catch {
    return; // Can't stat — leave it.
  }
  await safeUnlink(filePath);
}

/**
 * Safely clean up a single orphaned transition guard file.  Only removes the
 * file when the filename matches the exact safe-session grammar
 * (`<safeSessionId>.lock.tguard`), it is a regular non-symlink direct child
 * of chatsDir, and its content indicates staleness.  Unknown files and
 * symlinks are never deleted.
 */
async function cleanupStaleGuard(
  chatsDir: string,
  fileName: string,
): Promise<void> {
  const guardIdMatch = fileName.match(/^(.+)\.lock\.tguard$/);
  if (!guardIdMatch) return;
  if (!isValidSafeSessionId(guardIdMatch[1])) return;
  const guardPath = path.join(chatsDir, fileName);
  if (!isDirectChildPath(chatsDir, guardPath)) return;
  try {
    const lstat = await fs.lstat(guardPath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) return;
  } catch {
    return; // Can't stat — leave it.
  }
  if (await checkStaleWithPidReuse(guardPath)) {
    await safeUnlink(guardPath);
  }
}
