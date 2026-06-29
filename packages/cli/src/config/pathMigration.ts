/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:config:pathMigration');

// ─── Legacy entry categorization ──────────────────────────────────────────

/**
 * Top-level entries in legacy `~/.llxprt/` that belong to the **config**
 * category (user-editable configuration files).
 */
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

/**
 * Top-level entries in legacy `~/.llxprt/` that belong to the **data**
 * category (app-managed state, credentials, runtime data).
 */
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

/**
 * Top-level entries in legacy `~/.llxprt/` that belong to the **cache**
 * category (non-essential, regenerable files).
 */
const CACHE_ENTRIES = new Set(['cache', 'dumps']);

/**
 * Top-level entries in legacy `~/.llxprt/` that belong to the **log/state**
 * category (debug logs, undo checkpoints, runtime state).
 */
const LOG_ENTRIES = new Set(['debug', 'tmp']);

/**
 * Entries excluded from migration (managed by other migrations).
 * `secure-store/` is handled by issue #1357.
 */
const EXCLUDED_ENTRIES = new Set(['secure-store']);

/**
 * The `skills` subdirectory inside `tmp/` is a known historical misplacement
 * (skills are user-installed configuration, not temporary state). During
 * migration, `tmp/skills/` is routed to the config dir, not the log dir.
 */
const TMP_SKILLS_DIR = 'skills';

/**
 * Filename of the migration-completion marker. Stored in the data dir so that
 * unrelated writes to the config dir (prompt installs, profile saves, oauth,
 * etc.) cannot be mistaken for "migration already done" (#2237). The data dir
 * is app-managed state, which is the natural home for a one-time stamp.
 */
const MIGRATION_MARKER_FILE = '.migration-complete.json';

/**
 * Current migration scheme version recorded in the marker. Bumping this in a
 * future migration scheme allows a fresh pass to run even if an older marker
 * exists.
 */
const MIGRATION_MARKER_VERSION = 1;

export interface MigrationDestinations {
  readonly configDir: string;
  readonly dataDir: string;
  readonly cacheDir: string;
  readonly logDir: string;
}

export interface MigrationResult {
  readonly migrated: boolean;
  readonly reason: string;
  readonly filesCopied: number;
  readonly error?: boolean;
}

type Category = 'config' | 'data' | 'cache' | 'log' | 'exclude' | 'unknown';

function categorizeEntry(name: string): Category {
  if (EXCLUDED_ENTRIES.has(name)) return 'exclude';
  if (CONFIG_ENTRIES.has(name)) return 'config';
  if (DATA_ENTRIES.has(name)) return 'data';
  if (CACHE_ENTRIES.has(name)) return 'cache';
  if (LOG_ENTRIES.has(name)) return 'log';
  // Unknown entries default to data (safest — preserves them)
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

/**
 * Path to the migration-completion marker for a given set of destinations.
 */
function migrationMarkerPath(destinations: MigrationDestinations): string {
  return path.join(destinations.dataDir, MIGRATION_MARKER_FILE);
}

/**
 * Returns true when a migration-completion marker of the current scheme
 * version (or newer) is present. This is the authoritative "already migrated"
 * signal — it is independent of unrelated config-dir writes (#2237).
 */
export function isMigrationComplete(
  destinations: MigrationDestinations,
): boolean {
  const markerPath = migrationMarkerPath(destinations);
  let raw: string;
  try {
    raw = fs.readFileSync(markerPath, 'utf-8');
  } catch (error) {
    const nodeErr = error as NodeJS.ErrnoException;
    if (nodeErr.code !== 'ENOENT') {
      logger.debug(`Cannot read migration marker ${markerPath}: ${nodeErr}`);
    }
    return false;
  }

  try {
    const parsed = JSON.parse(raw) as { version?: number };
    return (
      typeof parsed.version === 'number' &&
      parsed.version >= MIGRATION_MARKER_VERSION
    );
  } catch {
    // Corrupt marker — treat as NOT complete so the (merge-safe) migration
    // re-runs and self-heals (#2237). A successful re-run writes a fresh, valid
    // marker, so this cannot loop. Permanently trusting a corrupt marker would
    // strand the very config this migration exists to recover.
    logger.debug(
      `Migration marker ${markerPath} is corrupt; re-running migration to self-heal.`,
    );
    return false;
  }
}

/**
 * Writes the migration-completion marker into the data dir, creating the
 * directory if necessary. Best-effort: failures are logged, not thrown.
 */
export function markMigrationComplete(
  destinations: MigrationDestinations,
): void {
  const markerPath = migrationMarkerPath(destinations);
  try {
    fs.mkdirSync(destinations.dataDir, { recursive: true });
    const payload = JSON.stringify(
      {
        version: MIGRATION_MARKER_VERSION,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    );
    // Write atomically (temp file + rename) so a crash mid-write cannot leave a
    // truncated/corrupt marker behind.
    const tmpPath = `${markerPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    fs.renameSync(tmpPath, markerPath);
  } catch (error) {
    logger.debug(`Cannot write migration marker ${markerPath}: ${error}`);
  }
}

/**
 * Returns true when the legacy `~/.llxprt/` directory has migratable content
 * and no migration-completion marker exists yet.
 *
 * The marker (not config-dir content) is the "already migrated" signal: many
 * subsystems write the config dir independently of the migration (prompt
 * installs, profile saves, oauth), so config-dir content must NOT short-circuit
 * the migration (#2237). Because {@link performMigration} merges without
 * overwriting, re-running on an already-partially-populated config dir safely
 * backfills only the missing entries (subagents/, commands/, etc.).
 *
 * Returns false when:
 * - The legacy directory does not exist or is empty (fresh install)
 * - The migration-completion marker is already present
 */
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

/**
 * Routes each legacy top-level entry to its correct category directory and
 * copies it using merge semantics (never overwrites existing files).
 *
 * The `tmp/` directory receives special treatment: its `skills/` subdirectory
 * is copied to the config dir (fixing a historical misplacement), while the
 * remaining contents go to the log dir.
 */
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

  let filesCopied = 0;
  const visited = new Set<string>();
  // Accumulates a message for every entry that could not be copied. A non-empty
  // list means the pass was partial, so the caller must NOT stamp the
  // completion marker — the next launch retries and self-heals (#2237).
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

  for (const entry of entries) {
    const category = categorizeEntry(entry.name);

    if (category === 'exclude') {
      continue;
    }

    try {
      if (
        entry.name === 'tmp' &&
        entry.isDirectory() &&
        !entry.isSymbolicLink()
      ) {
        filesCopied += migrateTmpDir(legacyDir, destinations, visited, errors);
      } else {
        const destDir = getDestDir(category, destinations);
        fs.mkdirSync(destDir, { recursive: true });
        const srcPath = path.join(legacyDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        filesCopied += copyEntry(
          srcPath,
          destPath,
          legacyDir,
          destDir,
          visited,
          errors,
        );
      }
    } catch (error) {
      errors.push(`${entry.name}: ${String(error)}`);
      logger.debug(`Failed to migrate entry '${entry.name}': ${String(error)}`);
    }
  }

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

/**
 * Copies the contents of `~/.llxprt/tmp/`, routing `skills/` to the config
 * dir and everything else to `logDir/tmp/`.
 */
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
      // Route tmp/skills → configDir/skills
      fs.mkdirSync(destinations.configDir, { recursive: true });
      count += copyEntry(
        path.join(tmpPath, TMP_SKILLS_DIR),
        path.join(destinations.configDir, TMP_SKILLS_DIR),
        legacyDir,
        destinations.configDir,
        visited,
        errors,
      );
    } else {
      // Route tmp/<x> → logDir/tmp/<x>
      const logTmpDir = path.join(destinations.logDir, 'tmp');
      fs.mkdirSync(logTmpDir, { recursive: true });
      count += copyEntry(
        path.join(tmpPath, subEntry.name),
        path.join(logTmpDir, subEntry.name),
        legacyDir,
        destinations.logDir,
        visited,
        errors,
      );
    }
  }

  return count;
}

/**
 * Runs the startup migration check using paths from the {@link Storage}
 * class. Skipped entirely when `LLXPRT_CONFIG_HOME` is set (explicit override).
 */
export function runStartupMigration(): MigrationResult {
  if (process.env['LLXPRT_CONFIG_HOME']) {
    return {
      migrated: false,
      reason: 'LLXPRT_CONFIG_HOME override is set; skipping migration',
      filesCopied: 0,
    };
  }

  const legacyDir = Storage.getLegacyLlxprtDir();
  const destinations: MigrationDestinations = {
    configDir: Storage.getGlobalConfigDir(),
    dataDir: Storage.getGlobalDataDir(),
    cacheDir: Storage.getGlobalCacheDir(),
    logDir: Storage.getGlobalLogDir(),
  };

  if (!shouldMigrate(legacyDir, destinations)) {
    if (isMigrationComplete(destinations)) {
      logger.debug(
        'Migration marker present; skipping migration from legacy path.',
      );
    }
    return { migrated: false, reason: 'no migration needed', filesCopied: 0 };
  }

  logger.debug(
    `Migrating configuration from ${legacyDir} to platform-standard paths ` +
      `(config: ${destinations.configDir}, data: ${destinations.dataDir}, ` +
      `cache: ${destinations.cacheDir}, log: ${destinations.logDir})…`,
  );

  try {
    const result = performMigration(legacyDir, destinations);
    logMigrationStatus(legacyDir, destinations, result);
    // Record completion so unrelated config-dir writes can't re-trigger or
    // (previously) permanently block migration (#2237). Written whenever the
    // pass did not error — including the benign "nothing left to copy" case —
    // so healthy installs are stamped and don't re-scan every startup. Failed
    // passes intentionally leave no marker so the next launch retries.
    if (result.error !== true) {
      markMigrationComplete(destinations);
    }
    return result;
  } catch (error) {
    logger.error('Configuration migration failed:', error);
    return {
      migrated: false,
      reason: `migration error: ${String(error)}`,
      filesCopied: 0,
      error: true,
    };
  }
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

// ─── internal helpers ───────────────────────────────────────────────────────

/**
 * Returns true when the directory contains at least one entry that would
 * actually be copied (i.e. is not in {@link EXCLUDED_ENTRIES}).
 */
function hasMigratableContent(dir: string): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (error) {
    const nodeErr = error as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return false;
    }
    logger.debug(`Cannot read directory ${dir}: ${String(error)}`);
    return true;
  }
  return entries.some((name) => !EXCLUDED_ENTRIES.has(name));
}

/**
 * Checks whether a path entry exists at all (including broken symlinks).
 * `fs.existsSync` follows symlinks and returns false for broken ones;
 * this function uses `lstatSync` to detect the entry itself.
 */
function pathEntryExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies a single regular file to `destPath`, then best-effort preserves the
 * source mode. Records any copy failure in `errors`. Returns 1 when the file
 * was copied, 0 when the copy was skipped or failed. The mode-preservation step
 * never affects the return value (a failed chmod still counts as a successful
 * copy).
 *
 * Uses `COPYFILE_EXCL` so the copy fails atomically if the destination already
 * exists. This closes the time-of-check/time-of-use gap left by the caller's
 * {@link pathEntryExists} guard: a file that appears between the check and the
 * copy is preserved (the `EEXIST` is treated as a benign skip, not an error).
 */
function copyFileWithMode(
  srcPath: string,
  destPath: string,
  errors: string[],
): number {
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      // Destination appeared after the caller's existence check; preserve it.
      return 0;
    }
    errors.push(`${srcPath}: ${String(error)}`);
    logger.debug(`Cannot copy file ${srcPath}: ${String(error)}`);
    return 0;
  }
  try {
    const { mode } = fs.statSync(srcPath);
    fs.chmodSync(destPath, mode);
  } catch {
    // mode preservation is best-effort; the file copy already succeeded
  }
  return 1;
}

/**
 * Copies a single entry (file, directory, or symlink) from `srcPath` to
 * `destPath`, using merge semantics — existing destination files are never
 * overwritten. Returns the count of regular files copied.
 */
function copyEntry(
  srcPath: string,
  destPath: string,
  legacyRoot: string,
  destRoot: string,
  visited: Set<string>,
  errors: string[],
): number {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(srcPath);
  } catch (error) {
    errors.push(`${srcPath}: ${String(error)}`);
    logger.debug(`Skipping inaccessible entry: ${srcPath}: ${String(error)}`);
    return 0;
  }

  if (stat.isSymbolicLink()) {
    if (pathEntryExists(destPath)) {
      return 0;
    }
    return createSymlinkClone(srcPath, destPath, legacyRoot, destRoot, errors);
  }

  if (stat.isFile()) {
    if (pathEntryExists(destPath)) {
      return 0;
    }
    return copyFileWithMode(srcPath, destPath, errors);
  }

  if (stat.isDirectory()) {
    return copyDirFiltered(
      srcPath,
      destPath,
      legacyRoot,
      destRoot,
      visited,
      errors,
    );
  }

  return 0;
}

/**
 * Recursively copies `src` into `dest`, skipping entries listed in
 * {@link EXCLUDED_ENTRIES} at the root level. Returns the count of regular
 * files copied. Tracks visited real paths to prevent infinite recursion via
 * symlink cycles.
 */
function copyDirFiltered(
  src: string,
  dest: string,
  legacyRoot: string,
  destRoot: string,
  visited: Set<string>,
  errors: string[],
): number {
  let realSrc: string;
  try {
    realSrc = fs.realpathSync(src);
  } catch (error) {
    errors.push(`${src}: ${String(error)}`);
    logger.debug(
      `Skipping inaccessible entry (broken symlink?): ${src}: ${String(error)}`,
    );
    return 0;
  }
  if (visited.has(realSrc)) {
    logger.debug(`Skipping already-visited directory (symlink cycle): ${src}`);
    return 0;
  }
  visited.add(realSrc);

  let count = 0;
  fs.mkdirSync(dest, { recursive: true });
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (error) {
    errors.push(`${src}: ${String(error)}`);
    logger.debug(`Cannot read directory ${src}: ${String(error)}`);
    return count;
  }

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      count += copyDirFiltered(
        srcPath,
        destPath,
        legacyRoot,
        destRoot,
        visited,
        errors,
      );
    } else if (entry.isFile() && !pathEntryExists(destPath)) {
      count += copyFileWithMode(srcPath, destPath, errors);
    } else if (entry.isSymbolicLink() && !pathEntryExists(destPath)) {
      count += createSymlinkClone(
        srcPath,
        destPath,
        legacyRoot,
        destRoot,
        errors,
      );
    }
  }

  return count;
}

/**
 * Creates a symlink at `destPath` mirroring the one at `srcPath`.
 * Relative targets are rebased so they resolve correctly from the new location.
 * Absolute targets that point inside the legacy tree are rebased to the
 * corresponding path under the new root.
 */
function createSymlinkClone(
  srcPath: string,
  destPath: string,
  legacyRoot: string,
  newRoot: string,
  errors: string[],
): number {
  let target: string;
  try {
    target = fs.readlinkSync(srcPath);
  } catch (error) {
    errors.push(`${srcPath}: ${String(error)}`);
    logger.debug(`Cannot read symlink ${srcPath}: ${String(error)}`);
    return 0;
  }
  try {
    if (path.isAbsolute(target)) {
      const rel = path.relative(legacyRoot, target);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        fs.symlinkSync(path.join(newRoot, rel), destPath);
      } else {
        fs.symlinkSync(target, destPath);
      }
    } else {
      const resolvedTarget = path.resolve(path.dirname(srcPath), target);
      const relFromLegacy = path.relative(legacyRoot, resolvedTarget);
      if (relFromLegacy.startsWith('..') || path.isAbsolute(relFromLegacy)) {
        // Target escapes legacy tree — preserve original target as-is
        fs.symlinkSync(target, destPath);
      } else {
        const rebased = path.relative(path.dirname(destPath), resolvedTarget);
        fs.symlinkSync(rebased, destPath);
      }
    }
    return 1;
  } catch (error) {
    errors.push(`${destPath}: ${String(error)}`);
    logger.debug(`Cannot create symlink at ${destPath}: ${String(error)}`);
    return 0;
  }
}
