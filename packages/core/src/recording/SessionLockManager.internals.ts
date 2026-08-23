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
 * - A per-session filesystem transition guard serializes the destructive
 *   pathname mutations — stale takeover, removeStaleLock, orphan cleanup,
 *   and release — so a stale checker does not unlink a replacement live
 *   lock.  The guard is an **identity-bearing claim file** at
 *   `<lockPath>.tguard` whose payload records the claimant's pid, a
 *   timestamp, a random claimToken, and the dev/ino of the lock observed
 *   at claim time.  It is installed exclusively via temp-file + hard-link
 *   (EEXIST means another process holds it), reclaimed only when its own
 *   payload indicates abandonment, and a reclaimer never displaces a live
 *   claimant: abandonment is judged against a hard-link probe, so a guard
 *   that is still held is never renamed or unlinked.  Every mutator
 *   verifies via {@link verifyTransitionClaim} that the guard still
 *   carries its own claimToken and the lock still has the recorded dev/ino
 *   before touching lockPath.  Release is ownership-checked.  Guard crash
 *   recovery preserves the live-PID/EPERM and 48-hour PID-reuse
 *   semantics.
 * - Retiring a stale lock is an atomic `rename` out of the well-known path
 *   ({@link retireStaleLock}), not a bare `unlink`.  Exactly one contender
 *   can win that rename, so contention over a stale lock resolves to a
 *   single owner independently of the guard, and a contender that captures
 *   a replacement live lock restores it instead of destroying it.
 * - Destructive janitor ownership is verified through the token-bound
 *   {@link LockHandle.ownsLock} immediately before mutation.
 *
 * What this protocol does not promise.  POSIX offers no compare-and-swap
 * unlink or rename, so between any check and any subsequent pathname
 * mutation there is a window.  Ownership is therefore carried by the
 * atomic primitives themselves — exclusive creation for publication and
 * `rename` for retirement — and the guard reduces, rather than eliminates,
 * the interleavings that reach those primitives.  Fresh publication in
 * {@link acquire} deliberately does not take the guard: it competes only
 * through exclusive creation, so it can lose but cannot destroy.  The
 * protocol also assumes a local filesystem; `link`, `rename` and `O_EXCL`
 * are not dependable over NFS or SMB, and `process.kill(pid, 0)` is
 * host-local while a lock carries no hostname.
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
 * Build a fresh single-use artifact path next to `lockPath`.
 *
 * The name matches the `<safeSessionId>.lock.<uuid>.locktmp` grammar, so the
 * existing {@link cleanupStaleLockTemp} sweep reclaims anything a crash leaves
 * behind and no additional cleanup path is needed.
 */
function makeLockTempPath(lockPath: string): string {
  return lockPath + '.' + crypto.randomUUID() + LOCK_TEMP_SUFFIX;
}

/** dev/ino identity of a filesystem entry, as exact decimal strings. */
interface FileIdentity {
  readonly dev: string;
  readonly ino: string;
}

/**
 * Read the dev/ino identity of `filePath`, or `null` when it does not exist.
 *
 * `bigint: true` is required rather than cosmetic: Windows file IDs are 64-bit
 * and inode numbers on some filesystems exceed `Number.MAX_SAFE_INTEGER`, so
 * the default number-valued `stat` would round two distinct files to the same
 * identity and let a replaced file pass verification.
 *
 * Errors other than ENOENT propagate.  A transient stat failure must not be
 * mistaken for "this path does not exist".
 */
async function statIdentity(filePath: string): Promise<FileIdentity | null> {
  try {
    const s = await fs.stat(filePath, { bigint: true });
    return { dev: s.dev.toString(), ino: s.ino.toString() };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
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
  const tempPath = makeLockTempPath(lockPath);

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
  const claim = await acquireTransitionGuard(lockPath);
  if (!claim) {
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

    // Verify the transition claim still identifies the same lock inode as
    // was observed at claim time and still carries this claim's token.  If the
    // lock was replaced by another process, the inodes will differ and we must skip.
    if (!(await verifyTransitionClaim(lockPath, claim))) {
      return false;
    }

    // Retire the stale lock.  Exactly one process can win the rename, so the
    // takeover resolves to a single owner even if the guard were bypassed.
    if (!(await retireStaleLock(lockPath, originalContent))) {
      return false;
    }

    // Atomically create our lock.  If another process won the race between
    // the retirement and this create, the link fails with EEXIST and we lose.
    return await tryCreateLock(lockPath, lockContent);
  } finally {
    await releaseTransitionGuard(claim);
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
  const claim = await acquireTransitionGuard(lockPath);
  if (!claim) {
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

    // Verify the transition claim still identifies the same lock inode as
    // was observed at claim time before unlinking.
    if (!(await verifyTransitionClaim(lockPath, claim))) {
      return false;
    }

    return await retireStaleLock(lockPath, originalContent);
  } finally {
    await releaseTransitionGuard(claim);
  }
}

/**
 * Retire a lock whose content has been judged stale, by atomically renaming it
 * out of the well-known path.
 *
 * `rename` is the only pathname primitive POSIX offers that removes a name and
 * tells exactly one caller that it did so.  That is what makes contention over
 * a stale lock resolve to a single owner: every other contender's rename fails
 * with ENOENT.  A bare `unlink` cannot distinguish "I removed the stale lock"
 * from "I removed the replacement that somebody else just published".
 *
 * A caller that captures a lock whose content is not the payload it judged
 * stale has captured a replacement live lock.  It puts that lock back and
 * reports failure rather than destroying it, preserving the invariant that no
 * process unlinks another process's lock.
 *
 * Returns true when this call retired the stale lock.
 */
async function retireStaleLock(
  lockPath: string,
  expectedContent: string,
): Promise<boolean> {
  const capturePath = makeLockTempPath(lockPath);
  try {
    await fs.rename(lockPath, capturePath);
  } catch {
    return false; // Lost the race, or the lock is already gone.
  }

  let capturedContent: string | null = null;
  try {
    capturedContent = await fs.readFile(capturePath, 'utf-8');
  } catch {
    // Unreadable: we cannot prove this is the lock we judged stale.
  }

  if (capturedContent !== expectedContent) {
    // Not the lock we judged — restore it instead of destroying it.
    try {
      await fs.link(capturePath, lockPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        // Restoration failed for some reason other than the path being taken,
        // so the capture may still be the only copy of a live lock.  Leave it
        // parked; {@link cleanupStaleLockTemp} reclaims it once its owner is
        // gone.
        return false;
      }
      // Another lock already occupies the path.  The captured one is therefore
      // superseded and unreachable — no code path ever reads a capture back,
      // and its owner's `ownsLock()` already reports false — so discarding it
      // loses nothing, while parking it would leak a file for the lifetime of
      // that owner's process.
    }
    await safeUnlink(capturePath);
    return false;
  }

  await safeUnlink(capturePath);
  return true;
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
  const claim = await acquireTransitionGuard(lockPath);
  if (!claim) {
    return; // Can't acquire guard — best-effort, leave lock in place.
  }
  try {
    const content = await fs.readFile(lockPath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;
    if (data.ownerToken !== ownerToken) {
      // We don't own this lock anymore — don't remove it.
      return;
    }
    // Verify the transition claim still identifies the same lock inode as
    // was observed at claim time before unlinking.
    if (!(await verifyTransitionClaim(lockPath, claim))) {
      return;
    }
    await fs.unlink(lockPath);
  } catch {
    // Best-effort release.
  } finally {
    await releaseTransitionGuard(claim);
  }
}

// -----------------------------------------------------------------------
// Per-session transition guard (root safety fix 1)
// -----------------------------------------------------------------------

/**
 * Identity of a transition claim held by this process.
 *
 * The guard is a distinct file (not a hard link of the lock inode) whose
 * payload records who claimed it, so reclaimability and verification always read
 * the **claimant's** own state rather than the victim lock's.
 */
interface TransitionClaim {
  /** Path of the guard file this claim installed. */
  readonly guardPath: string;
  /** Random token unique to this claim; a thief relinking the lock inode
   *  cannot forge it. */
  readonly claimToken: string;
  /** dev/ino of the lock as observed when this claim was installed, or null
   *  when no lock existed at claim time. */
  readonly lockIdentity: FileIdentity | null;
}

/**
 * Outcome of attempting to install a transition claim.
 *
 * `contended` and `failed` are kept apart because only contention implies an
 * incumbent claim whose liveness is worth consulting; a genuine I/O failure
 * leaves nothing to reclaim.
 */
type GuardInstallResult =
  | { readonly outcome: 'installed'; readonly claim: TransitionClaim }
  | { readonly outcome: 'contended' }
  | { readonly outcome: 'failed' };

/** Return the guard path for a given lock path. */
function getGuardPath(lockPath: string): string {
  return lockPath + TRANSITION_GUARD_SUFFIX;
}

/**
 * Write the guard payload to a temp file (O_EXCL), sync it, then
 * exclusively hard-link the temp to the guard path.  The temp name reuses the
 * existing `<safeSessionId>.lock.<uuid>.locktmp` grammar so the existing
 * `cleanupStaleLockTemp` orphan sweep already covers guard temps.
 *
 * Reports `installed` with the claim, `contended` when another process already
 * holds the guard, or `failed` for a genuine I/O error.  None of these throw:
 * guard acquisition has never thrown, and `release()` and the janitor sweep
 * are best-effort callers whose error surface must stay unchanged.
 */
async function installTransitionGuard(
  lockPath: string,
): Promise<GuardInstallResult> {
  const guardPath = getGuardPath(lockPath);

  // Capture the lock's dev/ino before writing the payload so verification can
  // detect the lock being replaced between claim time and mutation.  A missing
  // lock is a null identity — the guard is still installed, which is strictly
  // stronger serialization and removes the "release a guard we never created"
  // bug.  A stat failure that is NOT "absent" must report busy instead: a null
  // identity fails verification, which would make `releaseIfOwned` silently
  // leave a lock this process still owns.
  let lockIdentity: FileIdentity | null;
  try {
    lockIdentity = await statIdentity(lockPath);
  } catch {
    return { outcome: 'failed' };
  }

  const claimToken = crypto.randomUUID();
  const payload = JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
    claimToken,
    lockDev: lockIdentity?.dev ?? null,
    lockIno: lockIdentity?.ino ?? null,
  });

  const tempPath = makeLockTempPath(lockPath);
  let fd: fs.FileHandle | undefined;
  try {
    fd = await fs.open(tempPath, 'wx');
    await fd.writeFile(payload, 'utf-8');
    await fd.sync();
    await fd.close();
    fd = undefined;
    await fs.link(tempPath, guardPath);
  } catch (error: unknown) {
    // EEXIST is contention: another process holds the guard, and recovery
    // should consult that claimant's liveness.  Anything else (ENOSPC, EACCES,
    // EROFS, EDQUOT, EMFILE, ...) is a genuine I/O failure, where there is no
    // incumbent claim to reason about.  Neither throws: guard acquisition has
    // never thrown, and `release()` and the janitor sweep are best-effort and
    // must not start surfacing I/O errors.
    const code = (error as NodeJS.ErrnoException).code;
    return { outcome: code === 'EEXIST' ? 'contended' : 'failed' };
  } finally {
    await fd?.close().catch(() => {});
    await safeUnlink(tempPath);
  }
  return {
    outcome: 'installed',
    claim: { guardPath, claimToken, lockIdentity },
  };
}

/**
 * Acquire the per-session transition claim by installing a distinct guard file
 * whose payload identifies this claim (pid, timestamp, claimToken, and the
 * dev/ino of the lock observed at claim time).
 *
 * - A guard is installed exclusively via temp-file + hard-link; EEXIST means
 *   another process holds it, and recovery consults the incumbent claim's OWN
 *   liveness before touching it.
 * - A guard is installed even when the lock does not exist — strictly stronger
 *   serialization — and is released only by the claim that installed it.
 * - Any failure to install yields `null` (busy) instead of throwing, so the
 *   error surface of `release()` and the janitor sweep is unchanged.
 *
 * Returns the installed claim, or `null` meaning "busy — caller must not mutate".
 */
async function acquireTransitionGuard(
  lockPath: string,
): Promise<TransitionClaim | null> {
  const installed = await installTransitionGuard(lockPath);
  if (installed.outcome === 'installed') return installed.claim;
  // A genuine I/O failure leaves no incumbent claim to reason about, so there
  // is nothing to reclaim; report busy.
  if (installed.outcome === 'failed') return null;
  // Another process holds the claim — attempt conservative recovery.
  return tryReclaimGuard(lockPath);
}

/**
 * Decide whether the guard at `guardPath` has been abandoned by its claimant.
 *
 * Reclaim depends on the **claimant's** liveness, never on the staleness of
 * the lock being taken over.  A guard is only attributable to a claimant when
 * its payload carries a `claimToken`, which is the marker this implementation
 * writes.  Anything else — corrupt content, or a guard written by an older
 * revision that hard-linked the lock inode and therefore describes the victim
 * lock rather than the claimant — has no discoverable claimant, so it is
 * treated as busy and reclaimable only once it passes the age bound.  Without
 * that gate a legacy guard over a stale lock reads as abandoned to every
 * contender at once, which is the defect in issue #3277.
 *
 * Orphaned legacy guards still converge: the janitor's {@link cleanupStaleGuard}
 * sweep removes safe-grammar guards whose payload PID is dead.
 */
async function isGuardAbandoned(guardPath: string): Promise<boolean> {
  let claimToken: unknown;
  try {
    const parsed = JSON.parse(await fs.readFile(guardPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    claimToken = parsed.claimToken;
  } catch {
    // Unreadable or corrupt — no claimant identity.
    return isOlderThanBound(guardPath);
  }
  if (typeof claimToken !== 'string' || claimToken.length === 0) {
    return isOlderThanBound(guardPath);
  }
  // Our own format: the payload's pid/timestamp describe the claimant, so the
  // existing PID-reuse staleness rules answer "has the claimant gone away?".
  return checkStaleWithPidReuse(guardPath);
}

/**
 * Conservatively reclaim a stale transition claim.
 *
 * The guard now carries the claimant's own payload, so its staleness is the
 * claimant's liveness (dead PID, or an alive PID past the 48-hour PID-reuse
 * bound, or a guard with no discoverable claimant that is older than that
 * bound) — never the victim lock's staleness.
 *
 * Retirement is non-displacing (see {@link retireGuardIf}) and installation
 * then goes through the exclusive {@link installTransitionGuard} path, so we
 * may still lose to a racer and report `null`.
 */
async function tryReclaimGuard(
  lockPath: string,
): Promise<TransitionClaim | null> {
  const guardPath = getGuardPath(lockPath);
  if (!(await retireGuardIf(lockPath, guardPath, isGuardAbandoned))) {
    return null; // Live or unattributable claimant -> busy.
  }
  const installed = await installTransitionGuard(lockPath);
  return installed.outcome === 'installed' ? installed.claim : null;
}

/**
 * Retire the guard at `guardPath`, but only when `isRetirable` says its own
 * payload shows the claimant has gone away.
 *
 * The decision is made against a **hard-link probe** rather than against
 * `guardPath` itself.  That is the point: a guard belonging to a live claimant
 * is never renamed, unlinked, or even momentarily absent from the well-known
 * path, so deciding "busy" costs a live claimant nothing.  Deciding against the
 * well-known path instead would mean a slow decision could be followed by
 * renaming away whichever guard had since replaced the one it inspected.
 *
 * Only a guard that was proved retirable is retired, and retirement is an
 * atomic `rename` whose captured inode must equal the probed inode.  A
 * different guard installed between the probe and the rename is restored
 * rather than discarded.  `rename` also means exactly one of several
 * concurrent reclaimers retires a given guard; the rest see ENOENT.
 *
 * The probe deliberately carries the guard's own mtime, because `isRetirable`
 * may fall back to an age bound.  The post-rename check is an inode comparison
 * precisely so it does not depend on mtime, which `rename` preserves.
 *
 * Returns true when this call retired the guard.
 */
async function retireGuardIf(
  lockPath: string,
  guardPath: string,
  isRetirable: (probePath: string) => Promise<boolean>,
): Promise<boolean> {
  const probePath = makeLockTempPath(lockPath);
  let probeIdentity: FileIdentity | null;
  try {
    await fs.link(guardPath, probePath);
    probeIdentity = await statIdentity(probePath);
  } catch {
    await safeUnlink(probePath);
    return false; // No guard, or we cannot inspect one — treat as busy.
  }

  let retirable: boolean;
  try {
    retirable = await isRetirable(probePath);
  } catch {
    retirable = false;
  } finally {
    await safeUnlink(probePath);
  }
  if (!retirable || probeIdentity === null) return false;

  const capturePath = makeLockTempPath(lockPath);
  try {
    await fs.rename(guardPath, capturePath);
  } catch {
    return false; // Another reclaimer retired it first.
  }

  let capturedIdentity: FileIdentity | null = null;
  try {
    capturedIdentity = await statIdentity(capturePath);
  } catch {
    // Treated as a mismatch below.
  }
  if (
    capturedIdentity === null ||
    capturedIdentity.dev !== probeIdentity.dev ||
    capturedIdentity.ino !== probeIdentity.ino
  ) {
    // A different guard was installed between the probe and the rename — put
    // it back rather than displacing a claimant we never inspected.
    try {
      await fs.link(capturePath, guardPath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        // Restoration failed for some reason other than the path being taken,
        // so the capture may still be the only copy of a live claim.  Leave it
        // parked; {@link cleanupStaleLockTemp} reclaims it once its claimant is
        // gone.
        return false;
      }
      // Another guard already occupies the path, so the captured claim is
      // superseded: its holder can no longer pass verification and will abort
      // without mutating.  Discarding it loses nothing, while parking it would
      // leak a file for the lifetime of that claimant's process.
    }
    await safeUnlink(capturePath);
    return false;
  }

  await safeUnlink(capturePath);
  return true;
}

/**
 * Verify that the on-disk guard still carries this claim's own token and that
 * the lock path still identifies the inode observed at claim time.  Every
 * mutator must call this before unlinking lockPath:
 *
 * - The token check is what a thief cannot forge by relinking the lock inode.
 * - The dev/ino check preserves the protection against the lock being replaced
 *   between claim time and mutation (now recorded in the claim rather than
 *   inferred from the guard's inode).
 */
async function verifyTransitionClaim(
  lockPath: string,
  claim: TransitionClaim,
): Promise<boolean> {
  if (claim.lockIdentity === null) {
    return false; // No lock existed at claim time — nothing to mutate.
  }
  try {
    const guardContent = await fs.readFile(claim.guardPath, 'utf-8');
    const parsed = JSON.parse(guardContent) as Record<string, unknown>;
    if (parsed.claimToken !== claim.claimToken) {
      return false; // The guard is not ours anymore.
    }
    const lockIdentity = await statIdentity(lockPath);
    return (
      lockIdentity !== null &&
      lockIdentity.dev === claim.lockIdentity.dev &&
      lockIdentity.ino === claim.lockIdentity.ino
    );
  } catch {
    return false;
  }
}

/**
 * Release the transition guard (best-effort, ownership-checked).  Unlinks the
 * guard only while it still carries this claim's token — a process that never
 * installed the guard (or whose guard was already reclaimed) never unlinks another
 * process's guard.
 *
 * The token read and the unlink are not one atomic step, so a claim that is
 * legally retired between them would be unlinked by its predecessor.  Reaching
 * that requires our own claim to have passed the 48-hour PID-reuse bound while
 * this process was still alive and mid-release; claims here live for
 * milliseconds.  Closing it would mean renaming the guard away before reading
 * it, which reintroduces the displacement that {@link retireGuardIf} exists to
 * avoid, so the read-then-unlink order is deliberate.
 */
async function releaseTransitionGuard(claim: TransitionClaim): Promise<void> {
  try {
    const content = await fs.readFile(claim.guardPath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed.claimToken !== claim.claimToken) {
      return; // Not our claim — leave it.
    }
  } catch {
    return; // Best-effort.
  }
  await safeUnlink(claim.guardPath);
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
 * Return true when the payload at `filePath` names an owner that is still
 * alive, meaning the file may be the only remaining copy of a live lock or
 * transition claim and must not be reclaimed on age alone.
 *
 * Content that does not parse, or that carries no usable pid, is a partial
 * publication artifact rather than an owned payload.
 */
async function namesLiveOwner(filePath: string): Promise<boolean> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error: unknown) {
    // Cannot read it, so we cannot prove it is disposable.  A file whose
    // contents are unreadable can still be unlinked through a writable parent
    // directory, so answering "no owner" here would let a transient EACCES or
    // EMFILE destroy the only remaining copy of a live lock.  Only a confirmed
    // absence is safe to treat as "nothing to preserve".
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const pid = parsed.pid;
    if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) {
      return false; // Readable, but names no owner.
    }
  } catch {
    return false; // Readable partial write — a publication artifact.
  }
  return !(await checkStaleWithPidReuse(filePath));
}

/**
 * Safely clean up a single stale lock temp publication artifact.  Only
 * removes the file when it matches the exact generated grammar, is a
 * regular non-symlink direct child of chatsDir, is older than the
 * conservative age threshold, and does not name a live owner.  Unknown files
 * are never deleted.
 *
 * The liveness check is not optional.  {@link retireStaleLock} and
 * {@link retireGuardIf} can park a lock or claim under this grammar when a
 * capture cannot be restored, and a process can crash between the rename and
 * the restore, so a file matching this grammar is no longer guaranteed to be a
 * redundant copy.  Reclaiming on age alone would destroy a live owner's only
 * remaining copy.
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
  if (await namesLiveOwner(filePath)) return;
  await safeUnlink(filePath);
}

/**
 * Safely clean up a single orphaned transition guard file.  Only removes the
 * file when the filename matches the exact safe-session grammar
 * (`<safeSessionId>.lock.tguard`), it is a regular non-symlink direct child
 * of chatsDir, and its content indicates staleness.  Unknown files and
 * symlinks are never deleted.
 *
 * This sweep keeps the {@link checkStaleWithPidReuse} predicate rather than the
 * stricter {@link isGuardAbandoned}, because it is the escape hatch that lets a
 * guard with no `claimToken` — one written by an older revision — converge
 * instead of waiting out the age bound.  It goes through
 * {@link retireGuardIf} so that classifying a guard stale and removing it can
 * no longer straddle another process installing a live claim at that path.
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
  const lockPath = guardPath.slice(0, -TRANSITION_GUARD_SUFFIX.length);
  await retireGuardIf(lockPath, guardPath, checkStaleWithPidReuse);
}
