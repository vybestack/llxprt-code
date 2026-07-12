/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { repairProfiles } from './profileRepair.js';
import { copyEntry, pathEntryExists } from './legacyCopyEngine.js';
import { copyProfilesDirNormalized } from './legacyProfileNormalization.js';
import {
  hasErrnoCode,
  uniqueTempPath,
  parseMarkerStatus,
  fsyncDirSync,
  type MarkerStatus,
} from './localFsHelpers.js';
import type {
  MigrationDestinations,
  MigrationResult,
  StartupMigrationResult,
} from './migrationTypes.js';

// Re-export shared types so existing callers/tests that import from
// pathMigration.js continue to resolve without changes.
export type {
  MigrationDestinations,
  MigrationResult,
  StartupMigrationResult,
} from './migrationTypes.js';

export { repairProfiles } from './profileRepair.js';

const logger = new DebugLogger('llxprt:config:pathMigration');

const CONFIG_ENTRIES = new Set([
  'settings.json',
  'profiles',
  'subagents',
  'prompts',
  'commands',
  'policies',
  'sandboxes',
  'hooks',
  '.env',
  'LLXPRT.md',
  '.LLXPRT_SYSTEM',
]);

const DATA_ENTRIES = new Set([
  'oauth_creds.json',
  'google_accounts.json',
  'provider_accounts.json',
  'mcp-oauth-tokens.json',
  'installation_id',
  'machine_secret',
  'memory.md',
  'conversations',
  'history',
  'todos',
  'tools',
  'locks',
  'providers',
  'extensions',
]);

const CACHE_ENTRIES = new Set(['cache', 'dumps']);

const LOG_ENTRIES = new Set(['debug', 'tmp']);

const EXCLUDED_ENTRIES = new Set(['secure-store']);

const TMP_SKILLS_DIR = 'skills';

const MIGRATION_MARKER_FILE = '.migration-complete.json';

const MIGRATION_MARKER_VERSION = 1;

const REPAIR_MARKER_FILE = '.profile-repair-complete.json';

const REPAIR_MARKER_VERSION = 1;

type Category = 'config' | 'data' | 'cache' | 'log' | 'exclude' | 'unknown';

function categorizeEntry(name: string): Category {
  if (EXCLUDED_ENTRIES.has(name)) return 'exclude';
  if (CONFIG_ENTRIES.has(name)) return 'config';
  if (DATA_ENTRIES.has(name)) return 'data';
  if (CACHE_ENTRIES.has(name)) return 'cache';
  if (LOG_ENTRIES.has(name)) return 'log';
  return 'unknown';
}

function getDestDir(
  category: Category,
  destinations: MigrationDestinations,
): string {
  switch (category) {
    case 'config':
      return destinations.configDir;
    case 'data':
    case 'unknown':
      return destinations.dataDir;
    case 'cache':
      return destinations.cacheDir;
    case 'log':
      return destinations.logDir;
    default:
      return destinations.dataDir;
  }
}

function migrationMarkerPath(destinations: MigrationDestinations): string {
  return path.join(destinations.dataDir, MIGRATION_MARKER_FILE);
}

function repairMarkerPath(destinations: MigrationDestinations): string {
  return path.join(destinations.dataDir, REPAIR_MARKER_FILE);
}

export function isMigrationComplete(
  destinations: MigrationDestinations,
): boolean {
  return isMarkerAtVersion(
    migrationMarkerPath(destinations),
    MIGRATION_MARKER_VERSION,
  );
}

/** Log why a parsed marker is not current without parsing it again. */
function logMarkerReRun(markerPath: string, status: MarkerStatus): void {
  switch (status.kind) {
    case 'malformed-json':
      logger.debug(
        `Marker ${markerPath} is malformed (not valid JSON); re-running to self-heal.`,
      );
      return;
    case 'invalid-object':
      logger.debug(
        `Marker ${markerPath} is corrupt (not a JSON object); re-running to self-heal.`,
      );
      return;
    case 'missing-version':
      logger.debug(
        `Marker ${markerPath} is missing the version field; re-running to self-heal.`,
      );
      return;
    case 'invalid-type':
      logger.debug(
        `Marker ${markerPath} has a non-numeric version; re-running to self-heal.`,
      );
      return;
    case 'older':
      logger.debug(
        `Marker ${markerPath} is outdated (version ${status.version}); re-running to self-heal.`,
      );
      return;
    case 'current':
      return;
    default:
      status satisfies never;
  }
}

function isMarkerAtVersion(markerPath: string, minVersion: number): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(markerPath, 'utf-8');
  } catch (error) {
    if (!hasErrnoCode(error, 'ENOENT')) {
      logger.debug(`Cannot read marker ${markerPath}: ${String(error)}`);
    }
    return false;
  }

  const status = parseMarkerStatus(raw, minVersion);
  if (status.kind === 'current') {
    return true;
  }
  logMarkerReRun(markerPath, status);
  return false;
}

export function markMigrationComplete(
  destinations: MigrationDestinations,
): boolean {
  return writeMarker(migrationMarkerPath(destinations), destinations);
}

function markRepairComplete(destinations: MigrationDestinations): boolean {
  return writeMarker(repairMarkerPath(destinations), destinations);
}

function writeMarker(
  markerPath: string,
  destinations: MigrationDestinations,
): boolean {
  try {
    fs.mkdirSync(destinations.dataDir, { recursive: true });
    const payload = JSON.stringify(
      {
        version: markerPath.endsWith(REPAIR_MARKER_FILE)
          ? REPAIR_MARKER_VERSION
          : MIGRATION_MARKER_VERSION,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    const dir = path.dirname(markerPath);
    const base = path.basename(markerPath);
    const tmpPath = uniqueTempPath(dir, base, '.marker.tmp');
    try {
      fs.writeFileSync(tmpPath, payload, { encoding: 'utf-8', flag: 'wx' });
      const markerFd = fs.openSync(tmpPath, 'r');
      try {
        fs.fsyncSync(markerFd);
      } finally {
        fs.closeSync(markerFd);
      }
      fs.renameSync(tmpPath, markerPath);
      // fsync parent directory after rename for durability of the directory
      // entry update (best-effort on platforms that support it).
      fsyncDirSync(dir);
    } catch (error) {
      cleanupMarkerTemp(tmpPath);
      throw error;
    }
    return true;
  } catch (error) {
    logger.debug(`Cannot write marker ${markerPath}: ${error}`);
    return false;
  }
}

function cleanupMarkerTemp(tmpPath: string): void {
  if (!pathEntryExists(tmpPath)) {
    return;
  }
  fs.unlinkSync(tmpPath);
  fsyncDirSync(path.dirname(tmpPath));
}

export function shouldMigrate(
  legacyDir: string,
  destinations: MigrationDestinations,
): boolean {
  if (!fs.existsSync(legacyDir)) {
    return false;
  }
  if (!hasMigratableContent(legacyDir)) {
    return false;
  }
  if (isMigrationComplete(destinations)) {
    return false;
  }
  return true;
}

export function performMigration(
  legacyDir: string,
  destinations: MigrationDestinations,
): MigrationResult {
  if (!fs.existsSync(legacyDir)) {
    return {
      migrated: false,
      reason: 'legacy dir does not exist',
      filesCopied: 0,
    };
  }

  const visited = new Set<string>();
  const errors: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(legacyDir, { withFileTypes: true });
  } catch (error) {
    logger.debug(`Cannot read legacy directory ${legacyDir}: ${String(error)}`);
    return {
      migrated: false,
      reason: 'cannot read legacy directory',
      filesCopied: 0,
      error: true,
    };
  }

  const filesCopied = copyLegacyEntries(
    entries,
    legacyDir,
    destinations,
    visited,
    errors,
  );

  return buildMigrationResult(filesCopied, errors);
}

function copyLegacyEntries(
  entries: fs.Dirent[],
  legacyDir: string,
  destinations: MigrationDestinations,
  visited: Set<string>,
  errors: string[],
): number {
  let filesCopied = 0;
  for (const entry of entries) {
    const category = categorizeEntry(entry.name);
    if (category === 'exclude') {
      continue;
    }
    try {
      filesCopied += copyOneEntry(
        entry,
        category,
        legacyDir,
        destinations,
        visited,
        errors,
      );
    } catch (error) {
      errors.push(`${entry.name}: ${String(error)}`);
      logger.debug(`Failed to migrate entry '${entry.name}': ${String(error)}`);
    }
  }
  return filesCopied;
}

function copyOneEntry(
  entry: fs.Dirent,
  category: Category,
  legacyDir: string,
  destinations: MigrationDestinations,
  visited: Set<string>,
  errors: string[],
): number {
  if (entry.name === 'tmp' && entry.isDirectory() && !entry.isSymbolicLink()) {
    return migrateTmpDir(legacyDir, destinations, visited, errors);
  }
  const destDir = getDestDir(category, destinations);
  fs.mkdirSync(destDir, { recursive: true });
  const srcPath = path.join(legacyDir, entry.name);
  const destPath = path.join(destDir, entry.name);

  // Profile files directly under legacy profiles/ are normalized (missing
  // modelParams → modelParams:{}) and written with exclusive create so that
  // a pre-existing canonical file is NEVER touched, even when byte-identical
  // to the legacy source. This replaces the old post-rewrite approach that
  // compared canonical to legacy by byte equality.
  if (
    entry.name === 'profiles' &&
    entry.isDirectory() &&
    !entry.isSymbolicLink()
  ) {
    return copyProfilesDirNormalized(
      srcPath,
      destPath,
      visited,
      errors,
      logger,
    );
  }

  return copyEntry(
    srcPath,
    destPath,
    legacyDir,
    destDir,
    visited,
    errors,
    logger,
  );
}

function buildMigrationResult(
  filesCopied: number,
  errors: string[],
): MigrationResult {
  const hadErrors = errors.length > 0;

  if (filesCopied === 0) {
    return {
      migrated: false,
      reason: hadErrors
        ? 'migration incomplete (no files copied; some entries failed)'
        : 'no files to migrate (only excluded entries)',
      filesCopied: 0,
      error: hadErrors || undefined,
    };
  }

  return {
    migrated: !hadErrors,
    reason: hadErrors
      ? 'migration incomplete (some entries failed)'
      : 'migration complete',
    filesCopied,
    error: hadErrors || undefined,
  };
}

function migrateTmpDir(
  legacyDir: string,
  destinations: MigrationDestinations,
  visited: Set<string>,
  errors: string[],
): number {
  let count = 0;
  const tmpPath = path.join(legacyDir, 'tmp');

  let tmpEntries: fs.Dirent[];
  try {
    tmpEntries = fs.readdirSync(tmpPath, { withFileTypes: true });
  } catch (error) {
    errors.push(`tmp: ${String(error)}`);
    logger.debug(`Cannot read tmp directory ${tmpPath}: ${String(error)}`);
    return 0;
  }

  for (const subEntry of tmpEntries) {
    if (subEntry.name === TMP_SKILLS_DIR) {
      fs.mkdirSync(destinations.configDir, { recursive: true });
      count += copyEntry(
        path.join(tmpPath, TMP_SKILLS_DIR),
        path.join(destinations.configDir, TMP_SKILLS_DIR),
        legacyDir,
        destinations.configDir,
        visited,
        errors,
        logger,
      );
    } else {
      const logTmpDir = path.join(destinations.logDir, 'tmp');
      fs.mkdirSync(logTmpDir, { recursive: true });
      count += copyEntry(
        path.join(tmpPath, subEntry.name),
        path.join(logTmpDir, subEntry.name),
        legacyDir,
        destinations.logDir,
        visited,
        errors,
        logger,
      );
    }
  }

  return count;
}

/**
 * Startup orchestrator with explicit path inputs — testable without Storage.
 * Independently decides and runs path migration (marker v1) and one-time
 * profile repair (separate marker). Repair runs even when path migration v1
 * is already complete, without recopying legacy or resurrecting deleted state.
 *
 * Composability — why migration and repair are NOT wrapped in one
 * startup-wide lock (#4): no invariant requires atomicity across both
 * operations. Migration publishes canonical profiles with no-overwrite
 * semantics (hard-link/COPYFILE_EXCL), so a pre-existing canonical is never
 * touched. Repair acquires its own lock before scanning, so it sees a
 * consistent snapshot. A writer (ProfileManager save) between the two phases
 * simply becomes the canonical input to repair; the exact signature
 * (provider load-balancer + model gemini-2.5-pro) and byte-equality checks
 * protect against stale replacement. Therefore the separate operations are
 * composable and interleaving is benign.
 */
export function runStartupMigrationWithPath(
  legacyDir: string,
  destinations: MigrationDestinations,
): StartupMigrationResult {
  let migration: MigrationResult;
  if (shouldMigrate(legacyDir, destinations)) {
    logger.debug(
      `Migrating configuration from ${legacyDir} to platform-standard paths ` +
        `(config: ${destinations.configDir}, data: ${destinations.dataDir}, ` +
        `cache: ${destinations.cacheDir}, log: ${destinations.logDir})…`,
    );
    try {
      migration = performMigration(legacyDir, destinations);
      migration = finalizeMigrationMarker(migration, legacyDir, destinations);
    } catch (error) {
      logger.error('Configuration migration failed:', error);
      migration = {
        migrated: false,
        reason: 'configuration migration encountered an internal error',
        filesCopied: 0,
        error: true,
      };
    }
  } else {
    if (isMigrationComplete(destinations)) {
      logger.debug(
        'Migration marker present; skipping migration from legacy path.',
      );
    }
    migration = {
      migrated: false,
      reason: 'no migration needed',
      filesCopied: 0,
    };
  }

  // The repair marker is an audit record, not a skip gate. Re-scan on every
  // startup so another affected profile can be repaired if its legacy source
  // appears after an earlier successful repair.
  const repair = executeRepair(legacyDir, destinations);

  logStartupSummary(destinations, migration, repair);
  return { migration, repair };
}

/**
 * Finalize migration result after performMigration. If migration succeeded,
 * attempt to write the marker. Do NOT print durable migration success before
 * the marker succeeds. If the marker write fails, the migration result
 * becomes error:true with an explicit reason.
 */
function finalizeMigrationMarker(
  migration: MigrationResult,
  legacyDir: string,
  destinations: MigrationDestinations,
): MigrationResult {
  if (migration.error === true) {
    logMigrationStatus(legacyDir, destinations, migration);
    return migration;
  }
  const markerWritten = markMigrationComplete(destinations);
  if (markerWritten) {
    logMigrationStatus(legacyDir, destinations, migration);
    return migration;
  }
  logPartialMigration(legacyDir, destinations, migration);
  return {
    migrated: false,
    reason: 'migration completed but marker write failed',
    filesCopied: migration.filesCopied,
    error: true,
  };
}

/**
 * Runs the startup migration check using paths from {@link Storage}. Skipped
 * entirely when `LLXPRT_CONFIG_HOME` is set (explicit override). Delegates to
 * {@link runStartupMigrationWithPath}.
 */
export function runStartupMigration(): StartupMigrationResult {
  if (process.env['LLXPRT_CONFIG_HOME']) {
    return {
      migration: {
        migrated: false,
        reason: 'LLXPRT_CONFIG_HOME override is set; skipping migration',
        filesCopied: 0,
      },
      repair: {
        migrated: false,
        reason: 'LLXPRT_CONFIG_HOME override is set; skipping repair',
        filesCopied: 0,
      },
    };
  }

  const legacyDir = Storage.getLegacyLlxprtDir();
  const destinations: MigrationDestinations = {
    configDir: Storage.getGlobalConfigDir(),
    dataDir: Storage.getGlobalDataDir(),
    cacheDir: Storage.getGlobalCacheDir(),
    logDir: Storage.getGlobalLogDir(),
  };

  return runStartupMigrationWithPath(legacyDir, destinations);
}

/**
 * Outputs a user-facing message about the migration outcome.
 */
export function logMigrationStatus(
  legacyDir: string,
  destinations: MigrationDestinations,
  result: MigrationResult,
): void {
  if (result.migrated) {
    process.stderr.write(
      `Configuration migrated successfully (${result.filesCopied} files copied) ` +
        `to platform-standard paths.\n` +
        `  Config: ${destinations.configDir}\n` +
        `  Data:   ${destinations.dataDir}\n` +
        `  Cache:  ${destinations.cacheDir}\n` +
        `  Logs:   ${destinations.logDir}\n` +
        `The old directory at ${legacyDir} can be removed manually once verified.\n`,
    );
  }
}

function logPartialMigration(
  legacyDir: string,
  destinations: MigrationDestinations,
  result: MigrationResult,
): void {
  const fileWord = result.filesCopied === 1 ? 'file' : 'files';
  const copySummary =
    result.filesCopied === 0
      ? 'Configuration migration could not be finalized (no files copied)'
      : `Configuration partially migrated (${result.filesCopied} ${fileWord} copied)`;
  const outcome =
    result.filesCopied === 0
      ? 'No files required copying, and the finalization marker failed; '
      : 'The copying succeeded, but the finalization marker failed; ';
  process.stderr.write(
    `${copySummary} because the migration marker could not be written.\n` +
      `  Config: ${destinations.configDir}\n` +
      `  Data:   ${destinations.dataDir}\n` +
      `  Cache:  ${destinations.cacheDir}\n` +
      `  Logs:   ${destinations.logDir}\n` +
      outcome +
      `please retain the old directory at ${legacyDir} until the migration completes on a future startup.\n`,
  );
}

export interface StartupReport {
  /** Messages that should be written to stderr. */
  readonly messages: readonly string[];
  /** True when the legacy-dir fallback should be activated. */
  readonly needsLegacyFallback: boolean;
}

/**
 * Pure helper that turns a {@link StartupMigrationResult} into user-facing
 * stderr messages and a fallback decision. Extracted from the CLI setup so it
 * can be tested without filesystem side-effects.
 *
 * Semantics:
 * - Migration failure → warning + `needsLegacyFallback: true`.
 * - Migration success → no message here (logMigrationStatus handles that).
 * - Repair error → separate warning, but NO legacy fallback.
 * - Marker-write failure after successful repair → explicit warning.
 * - No duplicate warnings: repair summary success is already logged by
 *   {@link logStartupSummary}; this helper only surfaces errors.
 */
export function reportStartupResult(
  result: StartupMigrationResult,
  legacyDir: string,
): StartupReport {
  const messages: string[] = [];
  let needsLegacyFallback = false;

  const migration = result.migration;
  if (!migration.migrated && migration.error === true) {
    messages.push(
      `Warning: configuration migration failed (${migration.reason}). ` +
        `Falling back to legacy directory ${legacyDir} for this session.`,
    );
    needsLegacyFallback = true;
  }

  const repair = result.repair;
  if (repair.error === true) {
    messages.push(
      `Warning: profile repair could not complete (${repair.reason}). ` +
        `Some profiles may not load correctly.`,
    );
  }

  return { messages, needsLegacyFallback };
}

function executeRepair(
  legacyDir: string,
  destinations: MigrationDestinations,
): MigrationResult {
  try {
    const repair = repairProfiles(legacyDir, destinations);

    // Directive #3: 'busy' (lock held) is a benign deferral — NO error flag,
    // NO marker. Next startup retries.
    if (
      !repair.migrated &&
      repair.error !== true &&
      repair.reason.includes('lock busy')
    ) {
      return repair;
    }

    // Explicit error-first: if the repair itself failed, do NOT stamp the
    // marker. Return the error result before considering the no-op or
    // success cases.
    if (repair.error === true) {
      return repair;
    }

    // Directive #4: only stamp the repair marker when >=1 actual repair
    // happened. If no candidates were found ('none'), do NOT stamp so a
    // later appearance of affected profiles is not suppressed.
    if (
      repair.profilesRepaired === undefined ||
      repair.profilesRepaired === 0
    ) {
      return repair;
    }

    const markerWritten = markRepairComplete(destinations);
    if (markerWritten) {
      return repair;
    }
    return {
      migrated: false,
      reason: 'repair completed but marker write failed',
      filesCopied: 0,
      profilesRepaired: repair.profilesRepaired,
      error: true,
    };
  } catch (error) {
    logger.error('Profile repair failed:', error);
    return {
      migrated: false,
      reason: 'profile repair encountered an internal error',
      filesCopied: 0,
      error: true,
    };
  }
}

function logStartupSummary(
  destinations: MigrationDestinations,
  migration: MigrationResult,
  repair: MigrationResult,
): void {
  // Success summary: report repair count when profiles were actually repaired.
  // When migration also ran, logMigrationStatus already reported the file-copy
  // count; we only add the repair count here to avoid duplicate warnings.
  if (
    repair.profilesRepaired !== undefined &&
    repair.profilesRepaired > 0 &&
    repair.error !== true
  ) {
    process.stderr.write(
      `Repaired ${repair.profilesRepaired} profile(s) in ${destinations.configDir}.\n`,
    );
  }
}

// ─── internal helpers ───────────────────────────────────────────────────────

function hasMigratableContent(dir: string): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return false;
    }
    logger.debug(`Cannot read directory ${dir}: ${String(error)}`);
    return true;
  }
  return entries.some((name) => !EXCLUDED_ENTRIES.has(name));
}
