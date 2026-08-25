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
 * Reclamation engine for the session-recording janitor.
 *
 * Implements the four remaining retention semantics (Items 1–4):
 *
 * 1. **Actual-byte size reclamation**: removes fixed compression-savings
 *    estimates.  Compresses eligible raws oldest-first, measuring the real
 *    post-compression bytes after each operation, and continues through all
 *    eligible raws (including after skips/failures) until the actual
 *    aggregate is within budget or no raw remains archivable.  Only then are
 *    cold archives evicted.
 *
 * 2. **Global explicit age/count semantics**: maxAge/maxCount bound the
 *    complete raw+archive session corpus via {@link SessionGroup}
 *    deduplication (no double-counting).  Protected sessions that breach an
 *    explicit limit are counted as shortfall.  Explicit-policy deletion of a
 *    raw is lock-owned and post-lock revalidated.
 *
 * 3. **Archive chronology/floor/order**: uses original-source mtime preserved
 *    on gzip, enforces minRetention for archives before any eviction, and
 *    applies deterministic tie-breakers via project hash + normalized
 *    path/filename.
 *
 * 4. **Failure isolation/diagnostics**: sequential per-candidate processing
 *    continues after failures and increments contextual counters truthfully.
 *    Source unlink failure after successful archive is reported and the
 *    duplicate state is preserved for the next sweep to reconcile.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ResolvedRetentionConfig,
  SessionCandidate,
} from './cleanupTypes.js';
import type { SessionGroup } from './sessionGrouping.js';
import {
  buildSessionGroups,
  evaluateGroupEligibility,
  compareGroupsOldestFirst,
  compareGroupsNewestFirst,
} from './sessionGrouping.js';
import { compressToArchive } from './archiveCompressor.js';
import { SessionLockManager, type LockHandle } from '../SessionLockManager.js';
import { readSessionJsonlHeader } from './sessionHeaderReader.js';
import { isRegularNonSymlinkFile, isPathContainedIn } from './sessionSafety.js';
import { ARCHIVE_DIR_NAME, scanGlobalSessions } from './sessionScanner.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Metrics accumulated during the reclamation phases. */
export interface ReclamationMetrics {
  readonly archived: number;
  readonly rawDeleted: number;
  readonly archiveDeleted: number;
  readonly failed: number;
  readonly skipped: number;
  readonly ageCountShortfall: number;
}

// ---------------------------------------------------------------------------
// Narrow fault seam for testing platform-only unlink failures (Item 4)
// ---------------------------------------------------------------------------

/**
 * Inject an alternative unlink implementation for testing.  When non-null,
 * {@link platformUnlink} delegates to it instead of the real `fs.unlink`.
 * Tests use this to exercise the post-archive source-unlink failure path
 * without mock theatre — the fault is a narrow, platform-only seam.
 */
let unlinkFaultFn: ((filePath: string) => Promise<void>) | null = null;

/** Install or clear the unlink fault for tests. */
export function setUnlinkFaultForTest(
  fn: ((filePath: string) => Promise<void>) | null,
): void {
  unlinkFaultFn = fn;
}

/** Perform an unlink, delegating to the fault injector when set. */
async function platformUnlink(filePath: string): Promise<void> {
  if (unlinkFaultFn !== null) {
    await unlinkFaultFn(filePath);
    return;
  }
  await fs.unlink(filePath);
}

// ---------------------------------------------------------------------------
// Internal state carried across phases
// ---------------------------------------------------------------------------

interface ReclamationState {
  totalBytes: number;
  archived: number;
  rawDeleted: number;
  archiveDeleted: number;
  failed: number;
  ageCountShortfall: number;
}

function freshState(totalBytes: number): ReclamationState {
  return {
    totalBytes,
    archived: 0,
    rawDeleted: 0,
    archiveDeleted: 0,
    failed: 0,
    ageCountShortfall: 0,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the full reclamation pipeline against the scanned candidates.
 *
 * Phase 1 applies explicit age/count limits (direct deletion under lock).
 * Phase 2 performs actual-byte size reclamation (compress raws first, then
 * evict archives).
 *
 * @returns Aggregated metrics including shortfall.
 */
export async function runReclamation(
  candidates: readonly SessionCandidate[],
  config: ResolvedRetentionConfig,
  bytesBefore: number,
  globalTempDir: string,
  currentSessionId: string | undefined,
): Promise<{ metrics: ReclamationMetrics; protectedGroupCount: number }> {
  const groups = buildSessionGroups(candidates);

  const eligibleGroups: SessionGroup[] = [];
  let protectedGroupCount = 0;
  for (const group of groups) {
    const eligibility = await evaluateGroupEligibility(group, config);
    if (eligibility === 'eligible') {
      eligibleGroups.push(group);
    } else {
      protectedGroupCount++;
    }
  }

  const state = freshState(bytesBefore);

  await processExplicitAgeCount(eligibleGroups, groups, config, state);

  await processSizeReclamation(
    eligibleGroups,
    config,
    state,
    globalTempDir,
    currentSessionId,
  );

  return {
    metrics: {
      archived: state.archived,
      rawDeleted: state.rawDeleted,
      archiveDeleted: state.archiveDeleted,
      failed: state.failed,
      skipped: protectedGroupCount,
      ageCountShortfall: state.ageCountShortfall,
    },
    protectedGroupCount,
  };
}

// ---------------------------------------------------------------------------
// Phase 1: Explicit age/count removal
// ---------------------------------------------------------------------------

/**
 * Identify and remove groups that breach an explicit maxAge or maxCount limit
 * (Item 2).
 *
 * The ranking is built over ALL groups (eligible + protected) so protected
 * sessions count toward the limit.  Eligible excess groups are removed via
 * lock-owned direct deletion.  Protected excess groups increment the
 * shortfall counter.
 *
 * Avoids double-counting by operating on groups, not individual files
 * (Item 2).
 */
async function processExplicitAgeCount(
  eligibleGroups: readonly SessionGroup[],
  allGroups: readonly SessionGroup[],
  config: ResolvedRetentionConfig,
  state: ReclamationState,
): Promise<void> {
  const excessSet = identifyExcessGroups(allGroups, config);
  if (excessSet.size === 0) return;

  for (const group of eligibleGroups) {
    if (!excessSet.has(group.sessionKey)) continue;

    if (group.raw !== null) {
      const outcome = await directDeleteRawUnderLock(group);
      if (outcome.deleted) {
        state.rawDeleted++;
        state.totalBytes -= group.raw.sizeBytes;
      }
      if (outcome.failed) state.failed++;
    }

    if (group.archive !== null) {
      const outcome = await safeDeleteArchive(group.archive);
      if (outcome.kind === 'deleted' || outcome.kind === 'already-absent') {
        state.archiveDeleted++;
        state.totalBytes -= group.archive.sizeBytes;
      }
      if (outcome.kind === 'failed') state.failed++;
    }
  }

  // Protected excess groups → shortfall (O(N+M) via Set lookup).
  const eligibleKeys = new Set(eligibleGroups.map((e) => e.sessionKey));
  for (const group of allGroups) {
    if (!excessSet.has(group.sessionKey)) continue;
    if (!eligibleKeys.has(group.sessionKey)) {
      state.ageCountShortfall++;
    }
  }
}

/**
 * Compute the set of session keys that breach an explicit maxAge or maxCount
 * limit over the complete raw+archive corpus (Item 2).
 *
 * maxAge: groups whose original mtime is older than the cutoff.
 * maxCount: groups ranked beyond the keep-count (newest-first).
 *
 * Both use the global ranking over ALL groups so protected sessions count
 * toward the limit.
 */
function identifyExcessGroups(
  allGroups: readonly SessionGroup[],
  config: ResolvedRetentionConfig,
): Set<string> {
  const excess = new Set<string>();

  if (config.maxAgeMs !== null) {
    const cutoff = Date.now() - config.maxAgeMs;
    for (const group of allGroups) {
      if (group.mtime.getTime() < cutoff) {
        excess.add(group.sessionKey);
      }
    }
  }

  if (config.maxCount !== null) {
    const ranked = [...allGroups].sort(compareGroupsNewestFirst);
    for (let i = config.maxCount; i < ranked.length; i++) {
      excess.add(ranked[i].sessionKey);
    }
  }

  return excess;
}

/**
 * Directly delete a raw recording under exclusive lock ownership and
 * post-lock revalidation (Item 2: "Explicit-policy deletion of a raw must
 * still be lock-owned and post-lock revalidated").
 */
async function directDeleteRawUnderLock(
  group: SessionGroup,
): Promise<{ deleted: boolean; failed: boolean }> {
  if (group.raw === null || group.sessionId === null) {
    return { deleted: false, failed: false };
  }

  const lock = await acquireLock(group);
  if (lock === null) return { deleted: false, failed: false };

  try {
    return await doDirectDelete(group, lock);
  } finally {
    await lock.release();
  }
}

/** Revalidate and directly unlink the raw after lock acquisition. */
async function doDirectDelete(
  group: SessionGroup,
  lock: LockHandle,
): Promise<{ deleted: boolean; failed: boolean }> {
  const candidate = group.raw;
  if (candidate === null) return { deleted: false, failed: false };

  if (!(await revalidateRawCandidate(candidate, group.sessionId))) {
    return { deleted: false, failed: false };
  }

  if (!(await lock.ownsLock())) {
    return { deleted: false, failed: false };
  }

  try {
    await platformUnlink(candidate.filePath);
    return { deleted: true, failed: false };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { deleted: true, failed: false };
    return { deleted: false, failed: true };
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Actual-byte size reclamation
// ---------------------------------------------------------------------------

/**
 * Reclaim space to meet the configured byte budget using ACTUAL
 * post-compression bytes — no fixed estimates (Item 1).
 *
 * The raw-compression loop processes eligible groups oldest-first.  After
 * each compression the real archive size is measured and the running total is
 * updated.  The loop continues through ALL eligible raws (including after
 * skips/failures) until the budget is met or no eligible raw remains
 * archivable.  Only then are cold archives evicted oldest-first.
 *
 * Archive eviction re-scans the filesystem so that archives created during
 * this sweep's compression phase are correctly considered for eviction
 * (Item 1: "prove no archive is evicted while another useful eligible raw
 * can be compressed").
 */
async function processSizeReclamation(
  eligibleGroups: readonly SessionGroup[],
  config: ResolvedRetentionConfig,
  state: ReclamationState,
  globalTempDir: string,
  currentSessionId: string | undefined,
): Promise<void> {
  const sorted = [...eligibleGroups].sort(compareGroupsOldestFirst);

  for (const group of sorted) {
    if (state.totalBytes <= config.maxTotalSizeBytes) break;
    if (group.raw !== null) {
      const outcome = await archiveAndDeleteRaw(group);
      if (outcome.archived) state.archived++;
      if (outcome.rawDeleted) {
        state.rawDeleted++;
        state.totalBytes -= group.raw.sizeBytes;
      }
      // Only add archive bytes to the running total when the archive is
      // freshly created.  When the archive pre-existed (group.archive !==
      // null) its bytes were already counted in the initial scan, so adding
      // them again would double-count.
      if (outcome.archiveBytes > 0 && group.archive === null) {
        state.totalBytes += outcome.archiveBytes;
      }
      if (outcome.failed) state.failed++;
    }
  }

  await evictArchivesForBudget(config, state, globalTempDir, currentSessionId);
}

interface ArchiveOutcome {
  archived: boolean;
  rawDeleted: boolean;
  archiveBytes: number;
  failed: boolean;
}

/**
 * Compress a raw session to a gzip archive and then unlink the source, all
 * under exclusive session-lock ownership (AC-7, Item 4).
 *
 * Returns the ACTUAL archive byte size so the caller can update its running
 * total with real post-compression bytes (Item 1).  When the source unlink
 * fails after a successful archive, the outcome reports `archived: true` but
 * `rawDeleted: false` and `failed: true`; the duplicate (raw + archive) is
 * preserved for the next sweep to reconcile (Item 4).
 */
async function archiveAndDeleteRaw(
  group: SessionGroup,
): Promise<ArchiveOutcome> {
  if (group.raw === null || group.sessionId === null) {
    return {
      archived: false,
      rawDeleted: false,
      archiveBytes: 0,
      failed: false,
    };
  }

  const lock = await acquireLock(group);
  if (lock === null) {
    return {
      archived: false,
      rawDeleted: false,
      archiveBytes: 0,
      failed: false,
    };
  }

  try {
    return await doArchiveAndDelete(group, lock);
  } finally {
    await lock.release();
  }
}

/** Acquire exclusive ownership for the group's raw, or null when busy. */
async function acquireLock(group: SessionGroup): Promise<LockHandle | null> {
  if (group.raw === null || group.sessionId === null) return null;
  try {
    return await SessionLockManager.acquire(group.chatsDir, group.sessionId);
  } catch {
    return null;
  }
}

/**
 * Revalidate the raw candidate immediately before archiving (Item 4 / root
 * safety fix 3).
 *
 * Confirms the candidate is still a contained regular non-symlink file, that
 * the scan-time dev/ino identity still matches (ruling out a replacement
 * between scan and mutation), that its canonical header still matches the
 * expected session ID, and that a fresh lstat rules out a symlink swap.  All
 * of these checks share the same skip outcome, so they are grouped here for
 * clarity.
 *
 * @returns `true` only when the candidate remains safe to archive.
 */
async function revalidateRawCandidate(
  candidate: SessionCandidate,
  expectedSessionId: string | null,
): Promise<boolean> {
  if (!(await isRegularNonSymlinkFile(candidate.filePath))) return false;

  const header = await readSessionJsonlHeader(candidate.filePath);
  if (header === null || header.sessionId !== expectedSessionId) return false;

  try {
    const stat = await fs.lstat(candidate.filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return false;
    // Mutation-time identity check: compare dev/ino from scan-time to ensure
    // the file was not replaced between scan and mutation (root fix 3).
    if (stat.dev !== candidate.dev || stat.ino !== candidate.ino) return false;
  } catch {
    return false;
  }

  return true;
}

/**
 * Compress to archive and unlink the source after full revalidation.
 *
 * Pre-archive identity/safety checks are delegated to
 * {@link revalidateRawCandidate} (Item 4).  Lock token ownership is
 * re-checked immediately before the final source unlink.
 */
async function doArchiveAndDelete(
  group: SessionGroup,
  lock: LockHandle,
): Promise<ArchiveOutcome> {
  const candidate = group.raw;
  if (
    candidate === null ||
    !(await revalidateRawCandidate(candidate, group.sessionId))
  ) {
    return {
      archived: false,
      rawDeleted: false,
      archiveBytes: 0,
      failed: false,
    };
  }

  const archiveDir = path.join(group.chatsDir, ARCHIVE_DIR_NAME);
  const result = await compressToArchive(candidate.filePath, archiveDir);
  if (!result.success || !result.archivePath) {
    // Protective refusals (source-invalid, existing-archive) are not platform
    // failures — data is retained and not counted as failed.  Genuine
    // platform failures (mkdir, hash, compress, verify, rename) are counted.
    const isPlatformFailure =
      result.errorKind !== undefined &&
      result.errorKind !== 'source-invalid' &&
      result.errorKind !== 'existing-archive';
    return {
      archived: false,
      rawDeleted: false,
      archiveBytes: 0,
      failed: isPlatformFailure,
    };
  }

  // Item 6: do NOT unlink the source when durability could not be established.
  if (!result.durableCommit) {
    return {
      archived: true,
      rawDeleted: false,
      archiveBytes: result.archiveBytes,
      failed: false,
    };
  }

  // Item 4: Verify lock ownership immediately before final source unlink.
  if (!(await lock.ownsLock())) {
    return {
      archived: true,
      rawDeleted: false,
      archiveBytes: result.archiveBytes,
      failed: false,
    };
  }

  const unlinkOutcome = await safeUnlinkSource(candidate.filePath);
  return {
    archived: true,
    rawDeleted: unlinkOutcome.deleted,
    archiveBytes: result.archiveBytes,
    failed: !unlinkOutcome.deleted && !unlinkOutcome.benignSkip,
  };
}

/** Unlink the source; benign ENOENT counts as deleted.  Revalidates identity. */
async function safeUnlinkSource(
  filePath: string,
): Promise<{ deleted: boolean; benignSkip: boolean }> {
  if (!(await isRegularNonSymlinkFile(filePath))) {
    return { deleted: false, benignSkip: true };
  }
  try {
    await platformUnlink(filePath);
    return { deleted: true, benignSkip: false };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { deleted: true, benignSkip: false };
    // Item 4: source unlink failure after successful archive must be reported.
    return { deleted: false, benignSkip: false };
  }
}

// ---------------------------------------------------------------------------
// Archive eviction (only after all eligible raws are compressed)
// ---------------------------------------------------------------------------

/**
 * Evict cold archives oldest-first until the byte budget is met (Item 1:
 * "Only then evict cold archives").
 *
 * Archives are only evicted after the raw-compression loop has exhausted all
 * eligible raws.  The minRetention floor is enforced for each archive using
 * its preserved original-source mtime (Item 3).
 *
 * Re-scans the filesystem so that archives created during this sweep's
 * compression phase are correctly considered.
 */
async function evictArchivesForBudget(
  config: ResolvedRetentionConfig,
  state: ReclamationState,
  globalTempDir: string,
  currentSessionId: string | undefined,
): Promise<void> {
  if (state.totalBytes <= config.maxTotalSizeBytes) return;

  let freshScan;
  try {
    freshScan = await scanGlobalSessions(globalTempDir, currentSessionId);
  } catch {
    // External filesystem error during rescan — increment truthful failure
    // diagnostic and exit gracefully per failure isolation (Item 4).
    state.failed++;
    return;
  }
  // Count per-project scan failures from the rescan (OCR 38/39).
  state.failed += freshScan.scanErrorCount;

  // Use the authoritative fresh scan total so any drift from the compression
  // phase's running estimate (e.g. reused archives, short-read variance) is
  // corrected before eviction decisions.
  state.totalBytes = freshScan.candidates.reduce(
    (sum, c) => sum + c.sizeBytes,
    0,
  );

  if (state.totalBytes <= config.maxTotalSizeBytes) return;

  const now = Date.now();
  const evictable: SessionCandidate[] = [];
  for (const candidate of freshScan.candidates) {
    if (
      candidate.kind === 'archive' &&
      now - candidate.mtime.getTime() >= config.minRetentionMs
    ) {
      evictable.push(candidate);
    }
  }

  evictable.sort(compareCandidatesOldestFirst);

  for (const archive of evictable) {
    if (state.totalBytes <= config.maxTotalSizeBytes) break;
    const outcome = await safeDeleteArchive(archive);
    if (outcome.kind === 'deleted' || outcome.kind === 'already-absent') {
      state.archiveDeleted++;
      state.totalBytes -= archive.sizeBytes;
    }
    if (outcome.kind === 'failed') state.failed++;
  }
}

/** Deterministic oldest-first comparison with project-hash + path tie-break. */
function compareCandidatesOldestFirst(
  a: SessionCandidate,
  b: SessionCandidate,
): number {
  const mtimeDiff = a.mtime.getTime() - b.mtime.getTime();
  if (mtimeDiff !== 0) return mtimeDiff;
  // The tie-break must be genuinely deterministic, which localeCompare is not:
  // it orders by the runtime's locale, and path.normalize emits `\` on Windows
  // and `/` elsewhere, so the same two archives could sort differently per
  // platform and locale. Fold to forward slashes and compare by code unit so
  // "lexicographically oldest" means one fixed thing everywhere.
  const aPath = path.normalize(a.filePath).replaceAll('\\', '/');
  const bPath = path.normalize(b.filePath).replaceAll('\\', '/');
  if (aPath < bPath) return -1;
  if (aPath > bPath) return 1;
  return 0;
}

/**
 * Typed outcome of an archive deletion attempt (AC-9, OCR 27/28).
 *
 * - `deleted`: the archive was unlinked.
 * - `already-absent`: the file vanished (ENOENT) — treated as successful
 *   convergence since the desired end state (no file) is reached.
 * - `protected`: a containment or non-symlink identity check failed — the
 *   file is retained and not counted as a failure (it may be a symlink or
 *   escape the managed root).
 * - `failed`: a platform error (EPERM, EACCES, EBUSY, …) prevented unlink —
 *   the archive is retained and the failure is counted truthfully.
 */
export type ArchiveDeleteOutcome =
  | { readonly kind: 'deleted' }
  | { readonly kind: 'already-absent' }
  | { readonly kind: 'protected' }
  | { readonly kind: 'failed' };

/**
 * Attempt to unlink a single archive, classifying the outcome (AC-9).
 *
 * Validates containment and non-symlink identity before unlink.  ENOENT is
 * benign convergence.  Platform errors (EPERM, EACCES, EBUSY) retain the
 * archive and are classified as `failed` so callers can increment truthful
 * failure diagnostics.
 */
async function safeDeleteArchive(
  archive: SessionCandidate,
): Promise<ArchiveDeleteOutcome> {
  if (!isPathContainedIn(archive.containerDir, archive.filePath)) {
    return { kind: 'protected' };
  }
  if (!(await isRegularNonSymlinkFile(archive.filePath))) {
    return { kind: 'protected' };
  }
  try {
    await platformUnlink(archive.filePath);
    return { kind: 'deleted' };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'already-absent' };
    return { kind: 'failed' };
  }
}
