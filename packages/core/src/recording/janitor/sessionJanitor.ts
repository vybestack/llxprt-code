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
 * Session-recording janitor orchestrator (AC-1 through AC-11).
 *
 * The elected janitor performs a global sweep across all 64-hex project-hash
 * directories under the global temp root.  It discovers recordings using the
 * canonical JSONL header reader, delegates reclamation (age/count + size) to
 * the {@link runReclamation} engine, cleans stale locks, and removes
 * genuinely empty directories.
 *
 * Concurrency safety:
 * - A single global filesystem lease ensures only one process mutates at a time.
 * - Each destructive raw-session operation acquires exclusive session-lock
 *   ownership and revalidates before proceeding.
 * - Unreadable recordings are retained and counted, never deleted.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ResolvedRetentionConfig,
  SessionCandidate,
  SessionCleanupResult,
  UserRetentionSettings,
} from './cleanupTypes.js';
import { scanGlobalSessions, ARCHIVE_DIR_NAME } from './sessionScanner.js';
import { JanitorLease, type JanitorLeaseHandle } from './janitorLease.js';
import { cleanupStaleTempArchives } from './archiveCompressor.js';
import { resolveRetentionConfig } from './retentionPolicy.js';
import { runReclamation } from './reclamationEngine.js';
import { SessionLockManager } from '../SessionLockManager.js';
import { debugLogger } from '../../utils/debugLogger.js';

/** Parameters for the cleanup entry point. */
export interface SessionCleanupParams {
  /** The global temp directory root (Storage.getGlobalTempDir()). */
  readonly globalTempDir: string;
  /** The current process's session ID (protected from deletion). */
  readonly currentSessionId?: string;
  /** Fully resolved retention configuration. */
  readonly config: ResolvedRetentionConfig;
  /** When true, suppress debug logging. */
  readonly quiet?: boolean;
}

/** Age threshold for recognizing stale temporary archive artifacts. */
const STALE_TEMP_ARCHIVE_AGE_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Narrow fault seam for testing platform-only rmdir failures (Item 4)
// ---------------------------------------------------------------------------

/**
 * Inject an alternative rmdir implementation for testing.  When non-null,
 * {@link platformRmdir} delegates to it instead of the real `fs.rmdir`.
 * Tests use this to exercise non-benign error counting without chmod
 * (which cannot reliably induce platform errors).
 */
let rmdirFaultFn: ((dirPath: string) => Promise<void>) | null = null;

/** Install or clear the rmdir fault for tests. */
export function setRmdirFaultForTest(
  fn: ((dirPath: string) => Promise<void>) | null,
): void {
  rmdirFaultFn = fn;
}

/** Perform an rmdir, delegating to the fault injector when set. */
async function platformRmdir(dirPath: string): Promise<void> {
  if (rmdirFaultFn !== null) {
    await rmdirFaultFn(dirPath);
    return;
  }
  await fs.rmdir(dirPath);
}

// ---------------------------------------------------------------------------
// Narrow test-only lifecycle hook: scan-to-mutation gap (Item 4)
// ---------------------------------------------------------------------------

/**
 * When non-null, invoked after the initial `scanGlobalSessions` returns and
 * before reclamation begins.  Tests use this to deterministically replace a
 * file on the real filesystem during the scan-to-mutation window, proving
 * that inode revalidation catches the replacement.
 */
let scanToMutationHook: (() => Promise<void>) | null = null;

/** Install or clear the scan-to-mutation hook for tests. */
export function setScanToMutationHookForTest(
  fn: (() => Promise<void>) | null,
): void {
  scanToMutationHook = fn;
}

/** Empty result factory.  Exported so the CLI can build coherent results. */
export function emptyResult(
  disabled = false,
  janitorWonLease = false,
  configuredByteLimit = 0,
): SessionCleanupResult {
  return {
    disabled,
    janitorWonLease,
    scanned: 0,
    archived: 0,
    rawDeleted: 0,
    archiveDeleted: 0,
    staleLocksRemoved: 0,
    skipped: 0,
    failed: 0,
    ageCountShortfall: 0,
    bytesBefore: 0,
    bytesAfter: 0,
    configuredByteLimit,
    overBudgetBytes: 0,
  };
}

/**
 * Main entry point for the session-recording janitor.
 *
 * This is the core orchestrator.  The CLI consumer resolves defaults from
 * user settings and passes a fully resolved config.
 */
export async function runSessionCleanup(
  params: SessionCleanupParams,
): Promise<SessionCleanupResult> {
  const { config, globalTempDir } = params;

  if (!config.enabled) {
    return emptyResult(true, false, config.maxTotalSizeBytes);
  }

  // AC-6: Acquire the global janitor lease.  Skip-on-busy.
  let lease: JanitorLeaseHandle | null;
  try {
    lease = await JanitorLease.tryAcquire(globalTempDir);
  } catch {
    // Genuine I/O failure creating the lease file (ENOSPC, EACCES, …).
    // Skip this sweep rather than masking the error as "busy".
    if (params.quiet !== true) {
      debugLogger.debug(
        'Session janitor: lease acquisition failed, skipping sweep.',
      );
    }
    return emptyResult(false, false, config.maxTotalSizeBytes);
  }
  if (lease === null) {
    if (params.quiet !== true) {
      debugLogger.debug(
        'Session janitor: another process holds the lease, skipping.',
      );
    }
    return emptyResult(false, false, config.maxTotalSizeBytes);
  }

  try {
    return await performSweep(params);
  } finally {
    await lease.release();
  }
}

/** Convenience wrapper that resolves retention settings from user input. */
export async function runSessionCleanupWithSettings(
  globalTempDir: string,
  currentSessionId: string | undefined,
  userSettings: UserRetentionSettings | undefined,
  quiet?: boolean,
): Promise<SessionCleanupResult> {
  const resolved = resolveRetentionConfig(userSettings);
  return runSessionCleanup({
    globalTempDir,
    currentSessionId,
    config: resolved,
    quiet,
  });
}

/** Perform the actual global sweep (assumes lease is already held). */
async function performSweep(
  params: SessionCleanupParams,
): Promise<SessionCleanupResult> {
  const { config, globalTempDir, currentSessionId } = params;

  // AC-5: Scan all 64-hex project-hash dirs globally.
  const { candidates, chatsDirs, scanErrorCount } = await scanGlobalSessions(
    globalTempDir,
    currentSessionId,
  );

  // Test-only hook: pause between scan and reclamation to exercise the
  // scan-to-mutation inode revalidation race.
  if (scanToMutationHook !== null) {
    await scanToMutationHook();
  }

  const bytesBefore = sumBytes(candidates);
  const staleLocksRemoved = await runStaleLockCleanup(chatsDirs);

  // Delegate reclamation (age/count + size-driven) to the engine.
  const { metrics } = await runReclamation(
    candidates,
    config,
    bytesBefore,
    globalTempDir,
    currentSessionId,
  );

  const cleanupErrors = await cleanupTempAndEmptyDirs(chatsDirs);

  return buildFinalResult(
    globalTempDir,
    currentSessionId,
    config,
    candidates.length,
    metrics.archived,
    metrics.rawDeleted,
    metrics.archiveDeleted,
    staleLocksRemoved,
    metrics.skipped,
    metrics.failed + cleanupErrors + scanErrorCount,
    metrics.ageCountShortfall,
    bytesBefore,
  );
}

/** Clean stale locks in every chats directory (AC-8). */
async function runStaleLockCleanup(
  chatsDirs: readonly string[],
): Promise<number> {
  let staleLocksRemoved = 0;
  for (const chatsDir of chatsDirs) {
    try {
      staleLocksRemoved +=
        await SessionLockManager.cleanupOrphanedLocks(chatsDir);
    } catch {
      // Best-effort.
    }
  }
  return staleLocksRemoved;
}

// ---------------------------------------------------------------------------
// Temp/empty-dir cleanup + result assembly
// ---------------------------------------------------------------------------

/** Clean stale temp archives and remove genuinely empty directories (AC-10).
 *  Returns the count of non-benign per-directory failures. */
async function cleanupTempAndEmptyDirs(
  chatsDirs: readonly string[],
): Promise<number> {
  let errors = 0;
  for (const chatsDir of chatsDirs) {
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    try {
      await cleanupStaleTempArchives(archiveDir, STALE_TEMP_ARCHIVE_AGE_MS);
    } catch {
      // Non-benign temp-archive cleanup error — count it.
      errors++;
    }
  }
  errors += await cleanupEmptyDirs(chatsDirs);
  return errors;
}

/**
 * Remove genuinely empty chats/ and 64-hex project directories using
 * non-recursive rmdir (AC-10).  ENOENT/ENOTEMPTY are benign; other errors
 * are counted and reported (Item 4) so diagnostics are not silently lost.
 *
 * The global temp root is NEVER removed (Item 1: no global-root removal).
 */
async function cleanupEmptyDirs(chatsDirs: readonly string[]): Promise<number> {
  let errors = 0;
  const hashDirsToCheck = new Set<string>();
  for (const chatsDir of chatsDirs) {
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    const archiveResult = await tryRmdir(archiveDir);
    if (archiveResult.error) errors++;
    const removed = await tryRmdir(chatsDir);
    if (removed.error) errors++;
    if (removed.removed) hashDirsToCheck.add(path.dirname(chatsDir));
  }
  for (const hashDir of hashDirsToCheck) {
    const result = await tryRmdir(hashDir);
    if (result.error) errors++;
  }
  return errors;
}

/** Non-recursive rmdir that swallows benign ENOENT/ENOTEMPTY (AC-9). */
async function tryRmdir(
  dirPath: string,
): Promise<{ removed: boolean; error: boolean }> {
  try {
    await platformRmdir(dirPath);
    return { removed: true, error: false };
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    // Benign: directory vanished or is not empty.
    if (code === 'ENOENT' || code === 'ENOTEMPTY') {
      return { removed: false, error: false };
    }
    // Non-benign: platform error — retain and surface diagnostics.
    return { removed: false, error: true };
  }
}

/** Compute the final result with a fresh byte scan. */
async function buildFinalResult(
  globalTempDir: string,
  currentSessionId: string | undefined,
  config: ResolvedRetentionConfig,
  scanned: number,
  archived: number,
  rawDeleted: number,
  archiveDeleted: number,
  staleLocksRemoved: number,
  skipped: number,
  failed: number,
  ageCountShortfall: number,
  bytesBefore: number,
): Promise<SessionCleanupResult> {
  let bytesAfter: number;
  let rescanErrors = 0;
  try {
    const finalScan = await scanGlobalSessions(globalTempDir, currentSessionId);
    bytesAfter = sumBytes(finalScan.candidates);
    rescanErrors = finalScan.scanErrorCount;
  } catch {
    // External filesystem error during final rescan — use the last known
    // bytesBefore as a conservative truthful estimate rather than a
    // fabricated zero, and increment failed (Item 4).
    bytesAfter = bytesBefore;
    rescanErrors = 1;
  }
  const overBudgetBytes = Math.max(0, bytesAfter - config.maxTotalSizeBytes);
  return {
    disabled: false,
    janitorWonLease: true,
    scanned,
    archived,
    rawDeleted,
    archiveDeleted,
    staleLocksRemoved,
    skipped,
    failed: failed + rescanErrors,
    ageCountShortfall,
    bytesBefore,
    bytesAfter,
    configuredByteLimit: config.maxTotalSizeBytes,
    overBudgetBytes,
  };
}

/** Sum physical bytes across all candidates. */
function sumBytes(candidates: readonly SessionCandidate[]): number {
  let total = 0;
  for (const c of candidates) {
    total += c.sizeBytes;
  }
  return total;
}
