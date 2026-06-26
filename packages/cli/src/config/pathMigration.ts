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
 * Returns true when the legacy `~/.llxprt/` directory has content and the
 * config category directory does not yet exist (or is empty). The config
 * dir is used as the primary indicator of whether migration was already
 * performed, since it contains the most critical files (settings.json,
 * profiles, etc.).
 *
 * Returns false when:
 * - The legacy directory does not exist or is empty (fresh install)
 * - The config directory already has content (migration already done)
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

  if (
    fs.existsSync(destinations.configDir) &&
    directoryHasContent(destinations.configDir)
  ) {
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

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(legacyDir, { withFileTypes: true });
  } catch (error) {
    logger.debug(`Cannot read legacy directory ${legacyDir}: ${String(error)}`);
    return {
      migrated: false,
      reason: 'cannot read legacy directory',
      filesCopied: 0,
    };
  }

  for (const entry of entries) {
    const category = categorizeEntry(entry.name);

    if (category === 'exclude') {
      continue;
    }

    if (entry.name === 'tmp' && entry.isDirectory()) {
      filesCopied += migrateTmpDir(legacyDir, destinations, visited);
    } else {
      const destDir = getDestDir(category, destinations);
      fs.mkdirSync(destDir, { recursive: true });

      const srcPath = path.join(legacyDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      filesCopied += copyEntry(srcPath, destPath, legacyDir, destDir, visited);
    }
  }

  if (filesCopied === 0) {
    return {
      migrated: false,
      reason: 'no files to migrate (only excluded entries)',
      filesCopied: 0,
    };
  }

  return {
    migrated: true,
    reason: 'migration complete',
    filesCopied,
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
): number {
  let count = 0;
  const tmpPath = path.join(legacyDir, 'tmp');

  let tmpEntries: fs.Dirent[];
  try {
    tmpEntries = fs.readdirSync(tmpPath, { withFileTypes: true });
  } catch (error) {
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
  const legacyDir = Storage.getLegacyLlxprtDir();
  const destinations: MigrationDestinations = {
    configDir: Storage.getGlobalConfigDir(),
    dataDir: Storage.getGlobalDataDir(),
    cacheDir: Storage.getGlobalCacheDir(),
    logDir: Storage.getGlobalLogDir(),
  };

  if (process.env['LLXPRT_CONFIG_HOME']) {
    return {
      migrated: false,
      reason: 'LLXPRT_CONFIG_HOME override is set; skipping migration',
      filesCopied: 0,
    };
  }

  if (!shouldMigrate(legacyDir, destinations)) {
    if (
      fs.existsSync(destinations.configDir) &&
      directoryHasContent(destinations.configDir)
    ) {
      logger.debug(
        'Platform config already populated; skipping migration from legacy path.',
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

function directoryHasContent(dir: string): boolean {
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
  return entries.length > 0;
}

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
): number {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(srcPath);
  } catch (error) {
    logger.debug(`Skipping inaccessible entry: ${srcPath}: ${String(error)}`);
    return 0;
  }

  if (stat.isSymbolicLink()) {
    if (pathEntryExists(destPath)) {
      return 0;
    }
    createSymlinkClone(srcPath, destPath, legacyRoot, destRoot);
    return 1;
  }

  if (stat.isFile()) {
    if (pathEntryExists(destPath)) {
      return 0;
    }
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
    return 1;
  }

  if (stat.isDirectory()) {
    return copyDirFiltered(srcPath, destPath, legacyRoot, destRoot, visited);
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
): number {
  let realSrc: string;
  try {
    realSrc = fs.realpathSync(src);
  } catch (error) {
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
  const entries = fs.readdirSync(src, { withFileTypes: true });

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
      );
    } else if (entry.isFile() && !pathEntryExists(destPath)) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    } else if (entry.isSymbolicLink() && !pathEntryExists(destPath)) {
      createSymlinkClone(srcPath, destPath, legacyRoot, destRoot);
      count++;
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
): void {
  const target = fs.readlinkSync(srcPath);
  if (path.isAbsolute(target)) {
    const rel = path.relative(legacyRoot, target);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      fs.symlinkSync(path.join(newRoot, rel), destPath);
    } else {
      fs.symlinkSync(target, destPath);
    }
  } else {
    const resolvedTarget = path.resolve(path.dirname(srcPath), target);
    const rebased = path.relative(path.dirname(destPath), resolvedTarget);
    fs.symlinkSync(rebased, destPath);
  }
}
