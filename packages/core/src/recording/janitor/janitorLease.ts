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
 * Global cross-process janitor lease (AC-6, hardened Item 5).
 *
 * Exactly one concurrent starter wins the lease and performs the full sweep.
 * Non-winners detect the live lease and skip cleanup immediately.  The lease
 * uses atomic exclusive file creation (`O_EXCL` via temp+link), a random owner
 * token, PID, hostname, heartbeat, and owner-checked release.
 *
 * Hardened staleness (Item 5):
 * - Normal staleness is determined by **heartbeatAt** (not createdAt): a lease
 *   whose heartbeat is older than `STALE_LEASE_AGE_MS` and whose PID is gone
 *   is stale.
 * - A separate absolute PID-reuse bound (`PID_REUSE_BOUND_MS`) based on
 *   `createdAt` ensures a recycled PID cannot hold the lease indefinitely.
 * - All state transitions (takeover, heartbeat, release) verify the on-disk
 *   owner token before modifying, preventing overwrite/deletion of a
 *   replacement owner's lease.
 * - In-flight heartbeats are awaited before release.
 * - File descriptors are closed in `finally` blocks.
 * - Malformed leases that are older than the age bound are recovered (removed
 *   and retried); recent malformed leases cause a conservative skip.
 *
 * This is an internal implementation detail — no public abstraction or IPC
 * service.
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { hostname } from 'node:os';

/** Name of the lease file inside the global temp directory. */
const LEASE_FILE_NAME = '.llxprt-janitor.lease';

/** Normal staleness threshold: heartbeat older than this (with dead PID) is stale. */
const STALE_LEASE_AGE_MS = 10 * 60 * 1000; // 10 minutes

/** Absolute PID-reuse bound: a lease older than this is stale regardless of PID. */
const PID_REUSE_BOUND_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Heartbeat interval (ms). */
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds

/** Suffix for temporary lease files. */
const LEASE_TEMP_SUFFIX = '.lease.tmp';

/** Suffix for the well-known per-lease transition claim file (OCR 18/19). */
const LEASE_CLAIM_SUFFIX = '.tclaim';

/** On-disk lease record. */
interface LeaseRecord {
  readonly ownerToken: string;
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: string;
  readonly heartbeatAt: string;
}

/** Handle returned when a lease is acquired. */
export interface JanitorLeaseHandle {
  /** Release the lease.  Only removes the file if we still own it. */
  release(): Promise<void>;
}

/**
 * Result of acquiring the per-lease transition claim.
 *
 * `canProceed` indicates whether the caller may run its guarded operation.
 * `ownsClaim` indicates whether the caller created a real on-disk claim that
 * it MUST release.  When the lease vanishes (ENOENT) the caller may proceed
 * (nothing to serialize against) but owns no claim, so it must NOT unlink the
 * claim path — doing so could remove a contender's subsequently-created claim.
 */
interface TransitionClaimResult {
  readonly canProceed: boolean;
  readonly ownsClaim: boolean;
}

/**
 * The single global janitor lease manager.
 */
export class JanitorLease {
  private static heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private static inFlightHeartbeat: Promise<void> | undefined;

  /**
   * Test-only hook invoked in `tryStaleTakeover` after the staleness
   * pre-check passes but before the transition claim is acquired.  Lets
   * tests deterministically simulate a lease vanishing between the
   * pre-check and the claim (ENOENT race).  Mirrors the test-seam pattern in
   * `sessionJanitor.ts`.
   */
  private static preClaimHook: (() => Promise<void>) | null | undefined;

  /** Install or clear the pre-claim test hook. */
  static setPreClaimHookForTest(fn: (() => Promise<void>) | null): void {
    JanitorLease.preClaimHook = fn;
  }

  /**
   * Attempt to acquire the global janitor lease.
   */
  static async tryAcquire(
    globalTempDir: string,
  ): Promise<JanitorLeaseHandle | null> {
    const leasePath = path.join(globalTempDir, LEASE_FILE_NAME);

    try {
      await fsp.mkdir(globalTempDir, { recursive: true });
    } catch {
      return null;
    }

    const ownerToken = crypto.randomUUID();
    const now = new Date().toISOString();
    const record: LeaseRecord = {
      ownerToken,
      pid: process.pid,
      hostname: hostname(),
      createdAt: now,
      heartbeatAt: now,
    };

    // Attempt atomic exclusive creation via temp file + hard link.
    if (await JanitorLease.tryCreateLease(leasePath, record)) {
      JanitorLease.startHeartbeat(leasePath, ownerToken);
      return JanitorLease.makeHandle(leasePath, ownerToken);
    }

    // A lease file exists — check if it's stale and try to take over.
    return JanitorLease.tryStaleTakeover(leasePath, record);
  }

  /**
   * Atomically publish a lease via temp file + hard link.
   *
   * Returns `true` on success, `false` **only** for `EEXIST` (the lease
   * already exists).  Any other error (ENOSPC, EACCES, EROFS, EDQUOT, …) is
   * rethrown so the caller does not mistake a transient I/O failure for
   * "lease busy" and proceed to stale-takeover.
   */
  private static async tryCreateLease(
    leasePath: string,
    record: LeaseRecord,
  ): Promise<boolean> {
    const tempPath = leasePath + '.' + crypto.randomUUID() + LEASE_TEMP_SUFFIX;

    let fd: fsp.FileHandle | undefined;
    try {
      fd = await fsp.open(tempPath, 'wx');
      await fd.writeFile(JSON.stringify(record), 'utf-8');
      await fd.sync();
    } catch (error: unknown) {
      // Close the descriptor before unlinking: Windows refuses to remove a
      // file whose handle is still open, so cleanup must close first.  If
      // close itself fails, surface both the original I/O error and the
      // close failure (AggregateError) rather than silently claiming a safe
      // close, and skip unlink since the handle may still be open.
      if (fd) {
        try {
          await fd.close();
        } catch (closeError: unknown) {
          fd = undefined;
          throw new AggregateError(
            [error, closeError],
            'tryCreateLease: descriptor close failed during cleanup',
          );
        }
        fd = undefined;
      }
      await safeUnlink(tempPath);
      // EEXIST (uuid collision) is the only benign retryable case.
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error; // Propagate genuine I/O failures.
    } finally {
      await fd?.close().catch(() => {});
    }

    try {
      await fsp.link(tempPath, leasePath);
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      return false;
    } finally {
      // The hard link means leasePath shares the inode; unlinking temp
      // just decrements the link count.
      await safeUnlink(tempPath);
    }
  }

  /**
   * Attempt conservative stale takeover using heartbeat-based staleness,
   * protected by the hard-link inode-claim protocol (OCR 18/19).
   *
   * The well-known transition claim (`<leasePath>.tclaim`) is a hard link to
   * the current lease inode.  Only one contender can hold it at a time
   * (atomic `link`).  After acquiring it, the contender re-verifies
   * staleness and inode identity through the claim before unlinking the
   * lease pathname — so a stale contender can never unlink a replacement
   * live lease.
   *
   * A lease is stale when:
   *   - Its heartbeatAt is older than STALE_LEASE_AGE_MS AND its PID is dead
   *     (or on a different host), OR
   *   - Its createdAt exceeds the absolute PID_REUSE_BOUND_MS.
   */
  private static async tryStaleTakeover(
    leasePath: string,
    newRecord: LeaseRecord,
  ): Promise<JanitorLeaseHandle | null> {
    // Pre-check staleness WITHOUT the claim (avoids holding it during slow
    // PID checks).  Read through leasePath.
    let preContent: string | null;
    try {
      preContent = await fsp.readFile(leasePath, 'utf-8');
    } catch {
      preContent = null;
    }
    if ((await checkLeaseStaleness(preContent, leasePath)) !== 'stale') {
      return null;
    }

    // Test seam for deterministic race injection between pre-check and claim.
    if (JanitorLease.preClaimHook) {
      await JanitorLease.preClaimHook();
    }

    // Acquire the transition claim to serialize the mutation.
    const claim = await JanitorLease.acquireTransitionClaim(leasePath);
    if (!claim.canProceed) {
      return null; // Another transition is in progress — busy.
    }

    try {
      // Re-check staleness through the claim (the pinned inode's content).
      // A fresh heartbeat may have won the race since the pre-check.
      const claimPath = JanitorLease.getClaimPath(leasePath);
      let claimContent: string | null;
      try {
        claimContent = await fsp.readFile(claimPath, 'utf-8');
      } catch {
        // Can't read claim — the lease may have vanished.  Try to create
        // fresh directly.
        if (await JanitorLease.tryCreateLease(leasePath, newRecord)) {
          JanitorLease.startHeartbeat(leasePath, newRecord.ownerToken);
          return JanitorLease.makeHandle(leasePath, newRecord.ownerToken);
        }
        return null;
      }

      if ((await checkLeaseStaleness(claimContent, claimPath)) !== 'stale') {
        return null; // Became fresh — not stale anymore.
      }

      // Verify the lease inode still matches our claim.  If the lease was
      // replaced by another process, the inodes differ and we must skip.
      if (!(await JanitorLease.verifyTransitionClaim(leasePath))) {
        return null;
      }

      // Unlink the stale lease (same inode as claim — safe).
      try {
        await fsp.unlink(leasePath);
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') return null;
      }
    } finally {
      // Release only the claim we actually own, so a vanished-lease (ENOENT)
      // path never unlinks a contender's subsequently-created claim.
      if (claim.ownsClaim) {
        await JanitorLease.releaseTransitionClaim(leasePath);
      }
    }

    // Create fresh lease (outside the claim — racing acquisition may win).
    if (await JanitorLease.tryCreateLease(leasePath, newRecord)) {
      JanitorLease.startHeartbeat(leasePath, newRecord.ownerToken);
      return JanitorLease.makeHandle(leasePath, newRecord.ownerToken);
    }
    return null;
  }

  /**
   * Start a periodic heartbeat that updates the `heartbeatAt` field.
   * The heartbeat verifies ownership before writing to prevent overwriting
   * a replacement owner's lease.
   */
  private static startHeartbeat(leasePath: string, ownerToken: string): void {
    JanitorLease.stopHeartbeat();
    JanitorLease.heartbeatTimer = setInterval(() => {
      JanitorLease.inFlightHeartbeat = JanitorLease.updateHeartbeat(
        leasePath,
        ownerToken,
      ).catch(() => {
        // Best-effort heartbeat.
      });
    }, HEARTBEAT_INTERVAL_MS);
    JanitorLease.heartbeatTimer.unref();
  }

  private static stopHeartbeat(): void {
    if (JanitorLease.heartbeatTimer) {
      clearInterval(JanitorLease.heartbeatTimer);
      JanitorLease.heartbeatTimer = undefined;
    }
  }

  /**
   * Update the heartbeat field, but only if we still own the lease.
   *
   * Participates in the transition claim protocol (OCR 18/19) so a fresh
   * heartbeat cannot race a stale-takeover decision.  After acquiring the
   * claim, the heartbeat verifies ownership and inode identity through the
   * claim, then writes the updated record in place.  If a takeover
   * unlinks/replaces the pathname concurrently, the claim verification
   * catches the inode mismatch and the heartbeat is skipped.
   */
  private static async updateHeartbeat(
    leasePath: string,
    ownerToken: string,
  ): Promise<void> {
    const claim = await JanitorLease.acquireTransitionClaim(leasePath);
    if (!claim.canProceed) {
      return; // Another transition in progress — skip heartbeat.
    }
    try {
      const claimPath = JanitorLease.getClaimPath(leasePath);
      let content: string;
      try {
        content = await fsp.readFile(claimPath, 'utf-8');
      } catch {
        return; // Can't read — skip.
      }
      let record: LeaseRecord;
      try {
        record = JSON.parse(content) as LeaseRecord;
      } catch {
        return; // Malformed — skip.
      }
      if (record.ownerToken !== ownerToken) return; // Not ours.

      // Verify the lease inode still matches our claim.
      if (!(await JanitorLease.verifyTransitionClaim(leasePath))) {
        return; // Lease was replaced — skip.
      }

      // Write the updated heartbeat in place through leasePath.  Since we
      // hold the claim, no takeover can race this write.
      const updated: LeaseRecord = {
        ...record,
        heartbeatAt: new Date().toISOString(),
      };
      let fd: fsp.FileHandle | undefined;
      try {
        fd = await fsp.open(leasePath, 'r+');
        await fd.truncate(0);
        await fd.write(JSON.stringify(updated), 0, 'utf-8');
        await fd.sync();
      } catch {
        // Best-effort heartbeat.
      } finally {
        await fd?.close().catch(() => {});
      }
    } finally {
      if (claim.ownsClaim) {
        await JanitorLease.releaseTransitionClaim(leasePath);
      }
    }
  }

  /**
   * Release the lease, removing the file only when the on-disk owner token
   * still matches ours, and protected by the transition claim protocol so a
   * concurrent takeover cannot have its replacement unlinked (OCR 18/19).
   * Awaits any in-flight heartbeat before releasing.
   */
  private static async releaseLease(
    leasePath: string,
    ownerToken: string,
  ): Promise<void> {
    JanitorLease.stopHeartbeat();

    // Await any in-flight heartbeat before checking ownership.
    if (JanitorLease.inFlightHeartbeat) {
      await JanitorLease.inFlightHeartbeat.catch(() => {});
      JanitorLease.inFlightHeartbeat = undefined;
    }

    const claim = await JanitorLease.acquireTransitionClaim(leasePath);
    if (!claim.canProceed) {
      return; // Can't acquire claim — best-effort, leave lease in place.
    }
    try {
      // Verify ownership through the claim (the pinned inode's content).
      const claimPath = JanitorLease.getClaimPath(leasePath);
      let content: string;
      try {
        content = await fsp.readFile(claimPath, 'utf-8');
      } catch {
        return; // Can't read — best-effort.
      }
      let record: LeaseRecord;
      try {
        record = JSON.parse(content) as LeaseRecord;
      } catch {
        return; // Malformed — best-effort.
      }
      if (record.ownerToken !== ownerToken) return; // Not ours anymore.

      // Verify the lease inode still matches our claim.
      if (!(await JanitorLease.verifyTransitionClaim(leasePath))) {
        return; // Lease was replaced — don't unlink the replacement.
      }

      await fsp.unlink(leasePath);
    } catch {
      // Best-effort release.
    } finally {
      if (claim.ownsClaim) {
        await JanitorLease.releaseTransitionClaim(leasePath);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Per-lease transition claim (hard-link inode-claim protocol, OCR 18/19)
  // -----------------------------------------------------------------------

  /** Return the well-known transition claim path for a given lease path. */
  private static getClaimPath(leasePath: string): string {
    return leasePath + LEASE_CLAIM_SUFFIX;
  }

  /**
   * Acquire the per-lease transition claim by atomically hard-linking the
   * current lease inode to the well-known claim path.
   *
   * - `link(leasePath, claimPath)` succeeds for exactly one contender.
   * - ENOENT means the lease does not exist (no inode to claim — proceed
   *   without owning a claim).
   * - EEXIST means another contender owns the claim — try conservative reclaim.
   * - A crashed claim is a hard link, so removing it only decrements a link
   *   count and cannot remove or replace the live lease.
   */
  private static async acquireTransitionClaim(
    leasePath: string,
  ): Promise<TransitionClaimResult> {
    const claimPath = JanitorLease.getClaimPath(leasePath);
    try {
      await fsp.link(leasePath, claimPath);
      return { canProceed: true, ownsClaim: true }; // Claimed the lease inode.
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      // No lease exists — nothing to serialize against.  Proceed without a
      // claim so the caller can try to create a fresh lease, but DO NOT
      // release a claim we never created.
      if (code === 'ENOENT') return { canProceed: true, ownsClaim: false };
      if (code !== 'EEXIST') return { canProceed: false, ownsClaim: false };
    }
    return JanitorLease.tryReclaimClaim(leasePath);
  }

  /**
   * Conservatively reclaim a stale transition claim.
   *
   * The claim is a hard link to a lease inode, so its content IS the lease
   * content.  When the lease content indicates staleness, the claim owner has
   * crashed and the claim is safe to remove — it only decrements a link
   * count.  A live claim (fresh heartbeat or alive PID within bound) is
   * NEVER removed.
   */
  private static async tryReclaimClaim(
    leasePath: string,
  ): Promise<TransitionClaimResult> {
    const claimPath = JanitorLease.getClaimPath(leasePath);

    let claimContent: string | null;
    try {
      claimContent = await fsp.readFile(claimPath, 'utf-8');
    } catch {
      return { canProceed: false, ownsClaim: false }; // Can't read — can't determine staleness.
    }

    if ((await checkLeaseStaleness(claimContent, claimPath)) !== 'stale') {
      return { canProceed: false, ownsClaim: false }; // Live claim — never remove.
    }

    try {
      await fsp.unlink(claimPath);
    } catch {
      return { canProceed: false, ownsClaim: false };
    }

    // Retry the claim.  The lease inode may have changed during recovery.
    try {
      await fsp.link(leasePath, claimPath);
      return { canProceed: true, ownsClaim: true };
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { canProceed: true, ownsClaim: false }; // Lease vanished.
      return { canProceed: false, ownsClaim: false };
    }
  }

  /**
   * Verify that the transition claim and the lease path still identify the
   * same inode.  Every mutator must call this before unlinking leasePath.
   */
  private static async verifyTransitionClaim(
    leasePath: string,
  ): Promise<boolean> {
    const claimPath = JanitorLease.getClaimPath(leasePath);
    try {
      const leaseStat = await fsp.stat(leasePath);
      const claimStat = await fsp.stat(claimPath);
      return leaseStat.dev === claimStat.dev && leaseStat.ino === claimStat.ino;
    } catch {
      return false;
    }
  }

  /** Release the transition claim (best-effort). */
  private static async releaseTransitionClaim(
    leasePath: string,
  ): Promise<void> {
    await safeUnlink(JanitorLease.getClaimPath(leasePath));
  }

  /** Create a release handle bound to the owner token. */
  private static makeHandle(
    leasePath: string,
    ownerToken: string,
  ): JanitorLeaseHandle {
    return {
      release: async (): Promise<void> => {
        await JanitorLease.releaseLease(leasePath, ownerToken);
      },
    };
  }
}

/** Check whether a PID is alive by sending signal 0. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

/**
 * Determine whether a lease is stale based on its content and file mtime
 * (OCR 18/19 — shared by stale-takeover pre-check, claim re-check, and claim
 * reclaim).
 *
 * Staleness rules:
 * - Fresh heartbeat (< STALE_LEASE_AGE_MS) → not stale.
 * - Stale heartbeat + dead PID (on same host, within PID-reuse bound) → stale.
 * - Stale heartbeat + createdAt > PID_REUSE_BOUND_MS → stale (absolute bound).
 * - Malformed/unreadable content → stale only if file mtime > STALE_LEASE_AGE_MS
 *   (conservative recovery of crashed transitions; OCR 20 rejected — recent
 *   malformed leases are intentionally retained for 10 minutes).
 */
async function checkLeaseStaleness(
  content: string | null,
  filePathForMtime: string,
): Promise<'stale' | 'not-stale'> {
  if (content !== null) {
    try {
      const record = JSON.parse(content) as LeaseRecord;
      const heartbeatAge = Date.now() - new Date(record.heartbeatAt).getTime();
      const createdAge = Date.now() - new Date(record.createdAt).getTime();
      const heartbeatFresh = heartbeatAge < STALE_LEASE_AGE_MS;

      // A lease with a fresh heartbeat is NOT stale (Item 5).
      if (heartbeatFresh) return 'not-stale';

      // Heartbeat is stale — check PID and absolute age bound.
      const exceedsPidReuseBound = createdAge > PID_REUSE_BOUND_MS;
      if (
        !exceedsPidReuseBound &&
        record.hostname === hostname() &&
        isPidAlive(record.pid)
      ) {
        return 'not-stale';
      }
      return 'stale';
    } catch {
      // Malformed JSON — fall through to mtime-based recovery.
    }
  }

  // Unreadable or malformed — recover only if old enough by mtime.
  return (await isFileOlderThan(filePathForMtime, STALE_LEASE_AGE_MS))
    ? 'stale'
    : 'not-stale';
}

/** Check if a file's mtime is older than the given threshold. */
async function isFileOlderThan(
  filePath: string,
  maxAgeMs: number,
): Promise<boolean> {
  try {
    const stat = await fsp.stat(filePath);
    return Date.now() - stat.mtimeMs > maxAgeMs;
  } catch {
    return false;
  }
}

/** Best-effort unlink that swallows errors. */
async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fsp.unlink(filePath);
  } catch {
    // Best-effort.
  }
}
