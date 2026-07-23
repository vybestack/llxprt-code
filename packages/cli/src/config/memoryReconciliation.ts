/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type {
  MigrationDestinations,
  MigrationResult,
} from './migrationTypes.js';
import {
  hasErrnoCode,
  uniqueTempPath,
  fsyncDirSync,
  parseMarkerStatus,
  type MarkerStatus,
} from './localFsHelpers.js';
import { acquireReconcileLock, releaseReconcileLock } from './reconcileLock.js';

/**
 * Marker file written into the data dir once memory reconciliation has moved
 * any default-filename global memory files from data to config. A benign
 * no-source run does NOT stamp the marker; the marker is stamped only when
 * durable evidence of completed work exists (files reconciled, or
 * crash-after-archive evidence).
 */
export const MEMORY_RECONCILE_MARKER_FILE = '.memory-reconcile-complete.json';

/**
 * Cross-process advisory lock artifact. See {@link ./reconcileLock.ts} for the
 * identity-safe (PID-liveness) reclaim implementation.
 */
export { MEMORY_RECONCILE_LOCK_FILE } from './reconcileLock.js';

const MEMORY_RECONCILE_MARKER_VERSION = 1;

/**
 * Default global memory filenames covered by reconciliation. A user-configured
 * custom `contextFileName` is NOT covered because startup migration runs
 * before settings are loaded; such files must be moved manually.
 */
const RECONCILE_FILENAMES = ['LLXPRT.md', '.LLXPRT_SYSTEM'] as const;

const MIGRATED_SUFFIX = '.migrated-to-config';

/**
 * Reconciles global memory files that the production memory tool previously
 * wrote into the **data** directory (via the old CoreStorageServiceAdapter)
 * into the canonical **config** directory.
 *
 * Semantics (non-destructive, crash/retry-safe):
 * - Marker/version-gated: skips entirely when a current-version marker is
 *   present; self-heals on malformed/older markers.
 * - Concurrency-safe: acquires an advisory `O_EXCL` lock in the data dir;
 *   a busy lock is a benign deferral (no error, no mutation).
 * - Per file:
 *   - If `<data>/<file>` is absent → skip.
 *   - If `<data>/<file>.migrated-to-config` already exists → the file was
 *     fully consumed in a prior run; just remove a stray source and move on
 *     (never overwrite the existing backup, never re-append).
 *   - If the config already ends with the source content (a prior run
 *     published config but crashed before archiving) → skip the publish and
 *     only archive the source. This prevents duplicate-append on retry.
 *   - Otherwise: stage the merged config content in a temp file, fsync, and
 *     atomically rename into place (publish). Then archive the source with
 *     exclusive semantics, never overwriting an existing backup.
 * - Never deletes user data destructively; the source is preserved as a
 *   renamed `.migrated-to-config` backup.
 *
 * The marker is written only when durable evidence of completed work exists:
 * at least one file (re)conciled, or crash-after-archive evidence observed.
 * A benign empty no-source run does NOT stamp the marker (so a later source
 * appearance migrates normally).
 */
/**
 * Runs the reconciliation body (marker gate + per-file reconcile) and returns
 * the number of files reconciled plus an optional early-result (e.g. marker
 * skip). Extracted from {@link reconcileGlobalMemory} so lock acquire/release
 * orchestration stays separate from the reconciliation logic.
 *
 * Per-file marker identity (Finding #2): the marker records which filenames
 * have been reconciled. A single global marker must NOT suppress a later
 * source that was not present during the first run. Therefore, under the lock,
 * every run rescans the bounded data source paths ({@link RECONCILE_FILENAMES})
 * and reconciles any source whose per-file identity is not already recorded
 * (or whose source content differs from the archived backup). Idempotence and
 * no-duplicate-append are preserved; crash evidence is preserved.
 */
function runReconcileBody(
  destinations: MigrationDestinations,
  hooks?: ReconcileHooks,
): {
  filesReconciled: number;
  reconciledFilenames: string[];
  earlyResult?: MigrationResult;
  crashEvidence: boolean;
  exhaustedRetries: boolean;
} {
  // Marker gate: skip entirely ONLY when a current-version marker is present
  // AND every bounded source filename is absent (no late second source). A
  // current marker with a present source that is not yet reconciled must NOT
  // be suppressed.
  const reconciledFiles = readReconciledFiles(destinations);
  if (
    isMarkerCurrent(destinations) &&
    !hasUnreconciledSource(destinations, reconciledFiles)
  ) {
    return {
      filesReconciled: 0,
      reconciledFilenames: [],
      earlyResult: {
        migrated: false,
        reason: 'memory reconciliation marker present; skipping',
        filesCopied: 0,
      },
      crashEvidence: false,
      exhaustedRetries: false,
    };
  }
  let filesReconciled = 0;
  let crashEvidence = false;
  let exhaustedRetries = false;
  const reconciledFilenames: string[] = [];
  for (const filename of RECONCILE_FILENAMES) {
    const outcome = reconcileSingleFile(destinations, filename, hooks);
    if (outcome.reconciled) {
      filesReconciled += 1;
      reconciledFilenames.push(filename);
    }
    if (outcome.exhaustedRetries === true) {
      exhaustedRetries = true;
    }
    if (outcome.crashEvidence) {
      crashEvidence = true;
      // Crash evidence means this file's reconcile completed in a prior run;
      // record it as reconciled so the marker captures per-file identity.
      if (!reconciledFilenames.includes(filename)) {
        reconciledFilenames.push(filename);
      }
    }
  }
  return {
    filesReconciled,
    reconciledFilenames,
    crashEvidence,
    exhaustedRetries,
  };
}

/**
 * Composes the final result from the body outcome and the release error,
 * surfacing BOTH without masking either. A body error takes precedence but
 * includes the release error in its reason; a lone release error is surfaced
 * as its own error result.
 */
function composeReconcileResult(
  filesReconciled: number,
  earlyResult: MigrationResult | undefined,
  bodyError: unknown,
  releaseError: Error | undefined,
  markerWritten: boolean,
  markerError: Error | undefined,
  crashEvidence: boolean,
): MigrationResult | undefined {
  // Never discard an error. Compose body, marker, and release errors so each
  // is surfaced. A body error takes precedence but includes marker/release
  // details in its reason; a lone marker or release error is surfaced on its
  // own. AggregateError instances from the body are preserved (not
  // flattened/discarded) so every composed failure is visible.
  if (bodyError !== undefined) {
    const bodyMsg =
      bodyError instanceof Error ? bodyError.message : String(bodyError);
    const extras: string[] = [];
    if (markerError !== undefined) {
      extras.push(`marker write failed: ${markerError.message}`);
    }
    if (releaseError !== undefined) {
      extras.push(`lock release failed: ${releaseError.message}`);
    }
    const reason =
      extras.length > 0
        ? `global memory reconciliation encountered an internal error: ${bodyMsg}` +
          ` (additionally ${extras.join('; ')})`
        : `global memory reconciliation encountered an internal error: ${bodyMsg}`;
    return {
      migrated: false,
      reason,
      filesCopied: filesReconciled,
      error: true,
    };
  }
  // No body error. If the body ran a scan (no early marker-gate skip), the
  // marker is required when durable evidence of completed work exists — either
  // files were reconciled in this run, or crash-after-archive evidence was
  // observed (not every clean scan, only durable evidence). A benign empty
  // no-source run stamps no marker and is not an error. A failed marker write
  // when stamping was required is an error, composed with any release error so
  // neither is masked.
  const shouldStamp = filesReconciled > 0 || crashEvidence;
  if (earlyResult === undefined && !markerWritten && shouldStamp) {
    const parts: string[] = [];
    if (markerError !== undefined) {
      parts.push(`marker write failed: ${markerError.message}`);
    } else {
      parts.push('marker write failed');
    }
    if (releaseError !== undefined) {
      parts.push(`lock release failed: ${releaseError.message}`);
    }
    return {
      migrated: filesReconciled > 0,
      reason: `reconciliation completed but ${parts.join('; ')}`,
      filesCopied: filesReconciled,
      error: true,
    };
  }
  if (releaseError !== undefined) {
    return {
      migrated: filesReconciled > 0,
      reason:
        'memory reconciliation completed but its lock release failed: ' +
        releaseError.message,
      filesCopied: filesReconciled,
      error: true,
    };
  }
  return earlyResult;
}

export function reconcileGlobalMemory(
  destinations: MigrationDestinations,
  hooks?: ReconcileHooks,
): MigrationResult {
  // Same-path guard: when config and data resolve to the same directory,
  // reconciliation is a source-destination no-op. Detect this BEFORE acquiring
  // the lock or touching any file, because archiving (unlink) the "source"
  // would delete the very file we just published. Comparison uses resolved +
  // realpath where possible so symlinks and trailing-separator differences do
  // not cause a false negative.
  if (areSamePath(destinations.configDir, destinations.dataDir)) {
    return {
      migrated: false,
      reason:
        'memory reconciliation skipped: config and data directories resolve to the same path',
      filesCopied: 0,
    };
  }

  // Advisory lock — single attempt, no sleeps. Busy → benign deferral.
  let lockToken: string;
  try {
    lockToken = acquireReconcileLock(destinations);
  } catch (error) {
    if (error instanceof Error && error.name === 'ReconcileLockBusyError') {
      return {
        migrated: false,
        reason: 'memory reconciliation lock busy; deferred to next startup',
        filesCopied: 0,
      };
    }
    return {
      migrated: false,
      reason:
        'memory reconciliation could not acquire its lock: ' +
        (error instanceof Error ? error.message : String(error)),
      filesCopied: 0,
      error: true,
    };
  }

  const outcome = runReconcileUnderLock(destinations, lockToken, hooks);
  return outcome;
}

/**
 * Stamps the durable completion marker if durable evidence of completed work
 * exists (files reconciled or crash-after-archive evidence). Returns the
 * marker write state. When no stamp is needed (benign no-source run), returns
 * written=true with no error so the caller does not treat it as a failure.
 */
function stampMarkerIfNeeded(
  destinations: MigrationDestinations,
  bodyError: unknown,
  earlyResult: MigrationResult | undefined,
  filesReconciled: number,
  crashEvidence: boolean,
  reconciledFilenames: readonly string[],
): { written: boolean; error: Error | undefined } {
  if (bodyError !== undefined || earlyResult !== undefined) {
    return { written: false, error: undefined };
  }
  const shouldStamp = filesReconciled > 0 || crashEvidence;
  if (!shouldStamp) {
    return { written: true, error: undefined };
  }
  const priorFiles = readReconciledFiles(destinations);
  const mergedFiles = new Set<string>([...priorFiles, ...reconciledFilenames]);
  return writeReconcileMarkerCaptureError(
    destinations,
    [...mergedFiles].sort(),
  );
}

/**
 * Runs the reconciliation body while holding the lock, writes the marker when
 * durable evidence exists, releases the lock, and composes the final result.
 */
function runReconcileUnderLock(
  destinations: MigrationDestinations,
  lockToken: string,
  hooks?: ReconcileHooks,
): MigrationResult {
  let filesReconciled = 0;
  let earlyResult: MigrationResult | undefined;
  let bodyError: unknown;
  let markerError: Error | undefined;
  let markerWritten = false;
  let crashEvidence = false;
  let exhaustedRetries = false;
  try {
    const body = runReconcileBody(destinations, hooks);
    filesReconciled = body.filesReconciled;
    earlyResult = body.earlyResult;
    crashEvidence = body.crashEvidence;
    exhaustedRetries = body.exhaustedRetries;
    const markerState = stampMarkerIfNeeded(
      destinations,
      bodyError,
      earlyResult,
      filesReconciled,
      crashEvidence,
      body.reconciledFilenames,
    );
    markerWritten = markerState.written;
    markerError = markerState.error;
  } catch (error) {
    bodyError = error;
  }
  let releaseError: Error | undefined;
  try {
    releaseError = releaseReconcileLock(destinations, lockToken);
  } catch (error) {
    releaseError = error instanceof Error ? error : new Error(String(error));
  }

  const composed = composeReconcileResult(
    filesReconciled,
    earlyResult,
    bodyError,
    releaseError,
    markerWritten,
    markerError,
    crashEvidence,
  );
  if (composed !== undefined) {
    return composed;
  }
  if (filesReconciled === 0 && exhaustedRetries) {
    return {
      migrated: false,
      reason:
        'memory reconciliation deferred: sustained config contention exhausted retries; source preserved for next startup',
      filesCopied: 0,
      error: true,
    };
  }
  if (filesReconciled === 0) {
    return {
      migrated: false,
      reason: 'no global memory files needed reconciliation',
      filesCopied: 0,
    };
  }
  return {
    migrated: true,
    reason: `reconciled ${filesReconciled} global memory file(s) from data to config`,
    filesCopied: filesReconciled,
  };
}

/**
 * Injection hooks for deterministic interleaving tests of the reconciliation
 * publish path. Production callers omit these (undefined). Tests use
 * `onBeforeConfigPublish` to simulate a concurrent MemoryTool write between
 * the reconciliation's config read and its atomic publish, proving that
 * optimistic revalidation preserves both contents.
 */
export interface ReconcileHooks {
  /** Invoked immediately before the atomic config publish for a file. */
  onBeforeConfigPublish?(configPath: string): void;
}

const MAX_REVALIDATE_RETRIES = 3;

/**
 * Reconciles a single default global memory file from data to config.
 *
 * Returns an outcome describing whether a file was handled (copied, appended,
 * or archived) and whether durable crash evidence was observed.
 *
 * Lost-update protection (Finding #1): between reading the canonical config
 * and publishing the merged result, a concurrent MemoryTool write may land.
 * Before the atomic rename, the publish re-reads the config; if it changed,
 * the merge is recomputed from the new content and retried (up to
 * {@link MAX_REVALIDATE_RETRIES} times). This ensures a concurrent write is
 * never silently clobbered by the reconciliation rename.
 *
 * Crash evidence: when the data-side source is absent BUT the canonical
 * config exists AND a matching `.migrated-to-config` archive exists, this is
 * the durable signature of a prior run that published the config and
 * archived (unlinked) the source but crashed before writing the completion
 * marker. The canonical/archive state is consistent, so the next run should
 * stamp the marker to close the crash window. A benign empty
 * no-source run (no config, no archive, no source) is NOT crash evidence and
 * must NOT stamp the marker.
 *
 * Crash/retry safety (no duplicate append): when a prior run already
 * published the merged config but crashed before archiving the source, the
 * config already ends with the source content; in that case the publish is
 * skipped and only the source is archived.
 */
function reconcileSingleFile(
  destinations: MigrationDestinations,
  filename: string,
  hooks?: ReconcileHooks,
): { reconciled: boolean; crashEvidence: boolean; exhaustedRetries?: boolean } {
  const dataPath = path.join(destinations.dataDir, filename);
  const configPath = path.join(destinations.configDir, filename);
  const archivePath = dataPath + MIGRATED_SUFFIX;

  // No source to migrate. Distinguish a benign empty run from durable
  // crash-after-archive evidence: when the canonical config exists AND a
  // matching archive exists (with no source), the prior run completed the
  // destructive work (publish + archive/unlink) but crashed before the
  // marker. That consistent state warrants a marker. A benign empty run
  // (no config, no archive, no source) must NOT stamp a marker.
  if (!pathEntryExists(dataPath)) {
    const crashEvidence = hasCrashAfterArchiveEvidence(configPath, archivePath);
    return { reconciled: false, crashEvidence };
  }

  const dataContent = readDataFileOrEmpty(dataPath);
  if (dataContent.length === 0) {
    return reconcileZeroByteSource(
      dataPath,
      configPath,
      destinations,
      hooks,
      archivePath,
    );
  }

  fs.mkdirSync(destinations.configDir, { recursive: true });

  const existingConfig = readConfigForMerge(configPath);
  return reconcileNonEmptySource(
    dataPath,
    configPath,
    archivePath,
    existingConfig,
    dataContent,
    hooks,
  );
}

function reconcileNonEmptySource(
  dataPath: string,
  configPath: string,
  archivePath: string,
  initialConfig: string,
  dataContent: string,
  hooks: ReconcileHooks | undefined,
): { reconciled: boolean; crashEvidence: boolean; exhaustedRetries?: boolean } {
  let existingConfig = initialConfig;

  if (shouldSkipPublishAsAlreadyPublished(existingConfig, dataContent)) {
    archiveSource(dataPath, archivePath);
    return { reconciled: true, crashEvidence: false };
  }

  for (let attempt = 0; attempt <= MAX_REVALIDATE_RETRIES; attempt++) {
    const outcome = attemptRevalidationPublish(
      configPath,
      existingConfig,
      dataContent,
      hooks,
    );
    if (outcome.kind === 'retry') {
      existingConfig = outcome.updatedConfig;
      continue;
    }
    archiveSource(dataPath, archivePath);
    return { reconciled: true, crashEvidence: false };
  }
  // Retry exhaustion: do NOT best-effort overwrite. Instead return a typed
  // deferral so the source remains unarchived for the next startup. A
  // best-effort merge+publish could lose a concurrent MemoryTool write.
  // Returning a deferred outcome preserves the source for retry.
  return {
    reconciled: false,
    crashEvidence: false,
    exhaustedRetries: true,
  };
}
/**
 * Reconciles a zero-byte source: archives the source and ensures a canonical
 * file exists so the marker converges. When config already exists, its content
 * is preserved (an empty source does not truncate non-empty canonical content).
 * When config is absent, an empty canonical file is created using exclusive
 * (O_EXCL) semantics so a concurrent MemoryTool write that lands in the window
 * cannot be clobbered.
 */
function reconcileZeroByteSource(
  dataPath: string,
  configPath: string,
  destinations: MigrationDestinations,
  hooks: ReconcileHooks | undefined,
  archivePath: string,
): { reconciled: boolean; crashEvidence: boolean; exhaustedRetries?: boolean } {
  fs.mkdirSync(destinations.configDir, { recursive: true });
  hooks?.onBeforeConfigPublish?.(configPath);
  if (!pathEntryExists(configPath)) {
    createEmptyCanonicalExclusive(configPath, destinations.configDir);
  }
  archiveSource(dataPath, archivePath);
  return { reconciled: true, crashEvidence: false };
}

function createEmptyCanonicalExclusive(
  configPath: string,
  configDir: string,
): void {
  try {
    const fd = fs.openSync(configPath, 'wx', 0o644);
    fs.closeSync(fd);
    fsyncDirSync(configDir);
  } catch (error) {
    if (!hasErrnoCode(error, 'EEXIST')) {
      throw error;
    }
  }
}

type RevalidationOutcome =
  | { readonly kind: 'published' }
  | { readonly kind: 'already-published' }
  | { readonly kind: 'retry'; readonly updatedConfig: string };

function attemptRevalidationPublish(
  configPath: string,
  existingConfig: string,
  dataContent: string,
  hooks: ReconcileHooks | undefined,
): RevalidationOutcome {
  hooks?.onBeforeConfigPublish?.(configPath);
  const currentConfig = readConfigForMerge(configPath);
  const effectiveConfig = reconcileConcurrentConfig(
    configPath,
    existingConfig,
    currentConfig,
    dataContent,
  );
  if (effectiveConfig.kind === 'already-published') {
    return { kind: 'already-published' };
  }
  const merged = mergeContent(effectiveConfig.config, dataContent);
  publishConfigAtomic(configPath, merged);
  const postPublish = readConfigForMerge(configPath);
  if (postPublish === merged) {
    return { kind: 'published' };
  }
  return { kind: 'retry', updatedConfig: postPublish };
}

type ConcurrentConfigOutcome =
  | { readonly kind: 'unchanged'; readonly config: string }
  | { readonly kind: 'updated'; readonly config: string }
  | { readonly kind: 'already-published' };

function reconcileConcurrentConfig(
  _configPath: string,
  existingConfig: string,
  currentConfig: string,
  dataContent: string,
): ConcurrentConfigOutcome {
  if (currentConfig === existingConfig) {
    return { kind: 'unchanged', config: existingConfig };
  }
  // A concurrent write changed the config. If it already published the
  // data content, the source can be archived without a duplicate append.
  if (shouldSkipPublishAsAlreadyPublished(currentConfig, dataContent)) {
    return { kind: 'already-published' };
  }
  return { kind: 'updated', config: currentConfig };
}

/**
 * Returns true when durable crash-after-archive evidence exists for a
 * reconcile file: the canonical config is present AND a matching
 * `.migrated-to-config` archive exists AND no source remains. This is the
 * consistent state left by a prior run that published config and archived
 * (unlinked) the source but crashed before writing the completion marker.
 * Only this durable evidence warrants stamping the marker on a no-source
 * run; a benign empty run (no config, no archive) must NOT stamp it.
 */
function hasCrashAfterArchiveEvidence(
  configPath: string,
  archivePath: string,
): boolean {
  if (!pathEntryExists(configPath)) {
    return false;
  }
  // Crash evidence must discover a matching archive at the canonical
  // (unsuffixed) name OR any numeric suffixed name (`archivePath.1`,
  // `archivePath.2`, ...). A prior run that crashed after archiving to a
  // suffixed name (because the unsuffixed name was taken by an unrelated
  // older backup) and removed the source must be recognized as durable crash
  // evidence so the marker is repaired.
  const configContent = readConfigForMerge(configPath);
  if (configContent.length === 0) {
    return false;
  }
  if (archiveMatchesConfigTail(archivePath, configContent)) {
    return true;
  }
  for (let i = 1; i < 1000; i++) {
    if (archiveMatchesConfigTail(`${archivePath}.${i}`, configContent)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true when `candidateArchive` exists and its content matches the tail
 * of the canonical config content (the signature of a prior publish of the
 * same source). ENOENT or read failure returns false (no evidence).
 */
function archiveMatchesConfigTail(
  candidateArchive: string,
  configContent: string,
): boolean {
  if (!pathEntryExists(candidateArchive)) {
    return false;
  }
  const archiveContent = readArchiveContent(candidateArchive);
  if (archiveContent.length === 0) {
    return false;
  }
  return configContent.endsWith(archiveContent);
}

/**
 * Reads an archive file. Returns empty string on ENOENT; propagates other
 * read failures.
 */
function readArchiveContent(archivePath: string): string {
  try {
    return fs.readFileSync(archivePath, 'utf8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return '';
    }
    throw error;
  }
}

/**
 * Returns true when the existing config already contains the source content
 * as its tail — the signature of a prior publish that completed before a
 * crash interrupted source archival. Used to avoid duplicate-append on retry.
 */
function shouldSkipPublishAsAlreadyPublished(
  existingConfig: string,
  dataContent: string,
): boolean {
  if (existingConfig.length === 0 || dataContent.length === 0) {
    return false;
  }
  return existingConfig.endsWith(dataContent);
}

/**
 * Merges the migrated data content into the existing config content, choosing
 * a separator that avoids spurious blank lines regardless of trailing
 * newline. When the config is absent/empty the data content becomes the new
 * file body verbatim.
 */
function mergeContent(existingConfig: string, dataContent: string): string {
  if (existingConfig.length === 0) {
    return dataContent;
  }
  const separator = existingConfig.endsWith('\n') ? '\n' : '\n\n';
  return existingConfig + separator + dataContent;
}

/**
 * Reads the existing config file for merging. Returns an empty string when
 * the file is absent (ENOENT); any other read failure propagates.
 */
function readConfigForMerge(configPath: string): string {
  try {
    return fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return '';
    }
    throw error;
  }
}

/**
 * Reads the data-side memory file. ENOENT is treated as "no source" by the
 * caller; any other read failure is propagated.
 */
function readDataFileOrEmpty(dataPath: string): string {
  try {
    return fs.readFileSync(dataPath, 'utf8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return '';
    }
    throw error;
  }
}

/**
 * Publishes the merged config content atomically: write to a unique temp
 * file in the same directory, fsync, rename over the target, then fsync the
 * directory. The rename is atomic on POSIX and Windows, so a crash leaves
 * either the old or the new config — never a torn file.
 */
function publishConfigAtomic(configPath: string, merged: string): void {
  const dir = path.dirname(configPath);
  const base = path.basename(configPath);
  const tmpPath = uniqueTempPath(dir, base, '.reconcile.tmp');
  try {
    fs.writeFileSync(tmpPath, merged, { encoding: 'utf8', mode: 0o644 });
    const fd = fs.openSync(tmpPath, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, configPath);
    fsyncDirSync(dir);
  } catch (primaryError) {
    // Compose primary + cleanup errors so neither is masked.
    // cleanupTempQuietly returns the cleanup error (if any) instead of
    // throwing; we then throw an AggregateError carrying both.
    const cleanupError = cleanupTempQuietly(tmpPath);
    if (cleanupError !== undefined) {
      throw new AggregateError(
        [primaryError, cleanupError],
        `Config publish failed and temp cleanup failed for ${tmpPath}`,
      );
    }
    throw primaryError;
  }
}

/**
 * Archives the source file into `<source>.migrated-to-config` with exclusive
 * (never-overwrite) semantics. If the primary archive name already exists
 * (e.g. a prior backup of different content), falls back to a unique numeric
 * suffix so an existing source backup is NEVER overwritten. The original
 * source is removed once the backup is safely in place.
 */
function archiveSource(dataPath: string, archivePath: string): void {
  const dir = path.dirname(archivePath);
  // Archive convergence: before creating a new archive (suffixed or not),
  // detect whether an EXISTING archive already contains the exact same bytes
  // as the source. If so, the durable backup already exists and only the
  // source needs removal — no duplicate archive is created. This also handles
  // the crash/retry case where a prior run archived but crashed before (or
  // during) source removal.
  if (existingArchiveMatchesSource(dataPath, archivePath)) {
    removeSourceIfExists(dataPath);
    return;
  }
  const target = exclusiveArchiveTarget(archivePath);
  // copy+unlink (not rename) so we can use COPYFILE_EXCL to guarantee we
  // never overwrite an existing backup. If the copy succeeds but the unlink
  // fails, a retry sees the archive present and just cleans up the source.
  fs.copyFileSync(dataPath, target, fs.constants.COPYFILE_EXCL);
  // fsync the backup content to disk BEFORE removing the source, so a crash
  // after the source is removed cannot lose the only copy of the data
  // (durability — the backup must outlive source removal).
  const fd = fs.openSync(target, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Archive durability: fsync the parent directory BEFORE unlinking the
  // source so the archive's directory entry is durably established. A crash
  // between the archive fsync and the source unlink must leave the archive
  // recoverable; without this pre-unlink dir fsync, a crash could leave the
  // archive's directory entry unflushed while the source is already gone —
  // losing the only durable copy of the data.
  fsyncDirSync(dir);
  // removeSourceIfExists unlinks the source and fsyncs the directory again
  // after the unlink so both directory mutations are durable.
  removeSourceIfExists(dataPath);
}

/**
 * Archive convergence: detects whether an existing archive (unsuffixed or any
 * numeric suffix) already contains the exact same bytes as the source file.
 * When true, the durable backup already exists and the caller skips creating
 * a duplicate archive, removing only the source.
 *
 * Scans the canonical (unsuffixed) name first, then numeric suffixed
 * candidates (`archivePath.1`, `archivePath.2`, ...), so a crash that
 * archived to a suffixed name before source removal is also recognized as
 * convergent on retry.
 *
 * Returns true on the first byte-identical match; false when no existing
 * archive matches the source bytes.
 */
function existingArchiveMatchesSource(
  dataPath: string,
  archivePath: string,
): boolean {
  const sourceBytes = readSourceBytesSafely(dataPath);
  if (sourceBytes === null) {
    return false;
  }
  // Check the canonical (unsuffixed) name, then numeric suffixes.
  if (archiveBytesMatch(archivePath, sourceBytes)) {
    return true;
  }
  for (let i = 1; i < 1000; i++) {
    if (archiveBytesMatch(`${archivePath}.${i}`, sourceBytes)) {
      return true;
    }
  }
  return false;
}

/**
 * Reads the source file bytes. Returns null on ENOENT (source already gone —
 * nothing to match) or on read failure (treated as non-matching so the caller
 * does not skip archival based on an unverifiable read).
 */
function readSourceBytesSafely(dataPath: string): Buffer | null {
  try {
    return fs.readFileSync(dataPath);
  } catch {
    return null;
  }
}

/**
 * Returns true when `archivePath` exists and its bytes are identical to
 * `expected`. ENOENT or read failure returns false (no match).
 */
function archiveBytesMatch(archivePath: string, expected: Buffer): boolean {
  try {
    const archiveBytes = fs.readFileSync(archivePath);
    return Buffer.compare(archiveBytes, expected) === 0;
  } catch {
    return false;
  }
}
/**
 * Picks an archive target name that does not exist, so the subsequent
 * `COPYFILE_EXCL` copy succeeds without overwriting anything. Tries the
 * canonical name first, then numeric suffixes.
 */
function exclusiveArchiveTarget(archivePath: string): string {
  if (!pathEntryExists(archivePath)) {
    return archivePath;
  }
  for (let i = 1; i < 1000; i++) {
    const candidate = `${archivePath}.${i}`;
    if (!pathEntryExists(candidate)) {
      return candidate;
    }
  }
  // Extremely unlikely fallback: append a random suffix.
  return `${archivePath}.${crypto.randomUUID()}`;
}

function removeSourceIfExists(dataPath: string): void {
  try {
    fs.unlinkSync(dataPath);
    fsyncDirSync(path.dirname(dataPath));
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
}

/**
 * Best-effort temp cleanup that returns any failure instead of throwing, so
 * the caller can compose it with a primary error via AggregateError (never
 * mask a primary failure with a cleanup throw). Returns `undefined` on
 * success or benign ENOENT (already removed).
 */
function cleanupTempQuietly(tmpPath: string): Error | undefined {
  if (!pathEntryExists(tmpPath)) {
    return undefined;
  }
  try {
    fs.unlinkSync(tmpPath);
    return undefined;
  } catch (error) {
    // ENOENT is benign (already removed concurrently).
    if (hasErrnoCode(error, 'ENOENT')) {
      return undefined;
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function pathEntryExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return false;
    }
    throw error;
  }
}

/**
 * Returns true when two directory paths resolve to the same location.
 *
 * Same-path detection: when config and data are the same directory,
 * reconciliation would archive (unlink) a source that is the destination,
 * destroying data. This compares `path.resolve` of each path (handles
 * trailing separators and `.`/`..` segments) and, when both paths exist,
 * `fs.realpathSync` (handles symlinks and case-insensitive roots where
 * available). realpath failures (ENOENT, permission errors) fall back to the
 * resolved-path comparison so a missing directory is still detected as
 * same-path when the resolved forms match.
 */
function areSamePath(a: string, b: string): boolean {
  const resolvedA = path.resolve(a);
  const resolvedB = path.resolve(b);
  if (resolvedA === resolvedB) {
    return true;
  }
  // realpath handles symlinks (e.g. /var -> /private/var on macOS) and
  // case-insensitive filesystems where resolved-string comparison is
  // insufficient. Failures fall back to the resolved comparison above.
  const realA = tryRealpath(resolvedA);
  const realB = tryRealpath(resolvedB);
  if (realA !== null && realB !== null) {
    return realA === realB;
  }
  return false;
}

function tryRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

// ─── Marker ────────────────────────────────────────────────────────────────

function reconcileMarkerPath(destinations: MigrationDestinations): string {
  return path.join(destinations.dataDir, MEMORY_RECONCILE_MARKER_FILE);
}

/**
 * Reads the marker and returns whether it is a current-version marker.
 */
function isMarkerCurrent(destinations: MigrationDestinations): boolean {
  const markerPath = reconcileMarkerPath(destinations);
  let raw: string;
  try {
    raw = fs.readFileSync(markerPath, 'utf8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return false;
    }
    // Unreadable marker is not current; let the run self-heal.
    return false;
  }
  return (
    parseMarkerStatus(raw, MEMORY_RECONCILE_MARKER_VERSION).kind === 'current'
  );
}

/**
 * Reads the set of filenames recorded as reconciled in the current marker.
 * Returns an empty set when the marker is absent, malformed, or carries no
 * `files` array (legacy markers without per-file identity are treated as
 * having reconciled nothing, forcing a rescan — safe because the per-file
 * reconcile logic is idempotent and no-duplicate-append).
 */
function readReconciledFiles(destinations: MigrationDestinations): Set<string> {
  const markerPath = reconcileMarkerPath(destinations);
  let raw: string;
  try {
    raw = fs.readFileSync(markerPath, 'utf8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return new Set();
    }
    return new Set();
  }
  if (
    parseMarkerStatus(raw, MEMORY_RECONCILE_MARKER_VERSION).kind !== 'current'
  ) {
    return new Set();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    !('files' in parsed)
  ) {
    return new Set();
  }
  const files = (parsed as { files: unknown }).files;
  if (!Array.isArray(files)) {
    return new Set();
  }
  const result = new Set<string>();
  for (const f of files) {
    if (typeof f === 'string') {
      result.add(f);
    }
  }
  return result;
}

/**
 * Returns true when any bounded data source filename is present AND not yet
 * recorded as reconciled in the marker, OR a reconciled source has reappeared
 * with content differing from its archived backup. This ensures a late second
 * source is never suppressed by a global marker.
 */
function hasUnreconciledSource(
  destinations: MigrationDestinations,
  reconciledFiles: Set<string>,
): boolean {
  for (const filename of RECONCILE_FILENAMES) {
    const dataPath = path.join(destinations.dataDir, filename);
    if (!pathEntryExists(dataPath)) {
      continue;
    }
    if (!reconciledFiles.has(filename)) {
      return true;
    }
    // The file is recorded as reconciled but reappeared. If its content
    // matches the archived backup, it is a benign reappear (idempotent
    // skip). If it differs, it is a new/modified source that must be
    // reconciled.
    const archivePath = dataPath + MIGRATED_SUFFIX;
    if (!existingArchiveMatchesSource(dataPath, archivePath)) {
      return true;
    }
  }
  return false;
}

function writeReconcileMarkerCaptureError(
  destinations: MigrationDestinations,
  reconciledFiles: string[],
): { written: boolean; error: Error | undefined } {
  try {
    fs.mkdirSync(destinations.dataDir, { recursive: true });
    const markerPath = reconcileMarkerPath(destinations);
    const payload = JSON.stringify({
      version: MEMORY_RECONCILE_MARKER_VERSION,
      completedAt: new Date().toISOString(),
      files: reconciledFiles,
    });
    const dir = path.dirname(markerPath);
    const base = path.basename(markerPath);
    const tmp = uniqueTempPath(dir, base, '.marker.tmp');
    try {
      fs.writeFileSync(tmp, payload, {
        encoding: 'utf8',
        mode: 0o644,
        flag: 'wx',
      });
      const fd = fs.openSync(tmp, 'r');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, markerPath);
      fsyncDirSync(dir);
    } catch (primaryError) {
      // Compose primary + cleanup errors so neither is masked.
      const cleanupError = cleanupTempQuietly(tmp);
      if (cleanupError !== undefined) {
        throw new AggregateError(
          [primaryError, cleanupError],
          `Marker write failed and temp cleanup failed for ${tmp}`,
        );
      }
      throw primaryError;
    }
    return { written: true, error: undefined };
  } catch (error) {
    return {
      written: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export type { MarkerStatus };
