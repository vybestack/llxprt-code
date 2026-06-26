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

/**
 * The `secure-store/` subdirectory is managed by a separate migration
 * (issue #1357) and must not be copied here.
 */
const EXCLUDED_ENTRIES = new Set(['secure-store']);

export interface MigrationResult {
  readonly migrated: boolean;
  readonly reason: string;
  readonly filesCopied: number;
  readonly error?: boolean;
}

/**
 * Returns true when the legacy `~/.llxprt/` directory has content and the
 * new platform-standard path does not yet exist (or is empty).
 *
 * Returns false when:
 * - The legacy directory does not exist or is empty (fresh install)
 * - The new directory already has content (migration already done)
 */
export function shouldMigrate(legacyDir: string, newDir: string): boolean {
  if (!fs.existsSync(legacyDir)) {
    return false;
  }

  if (!hasMigratableContent(legacyDir)) {
    return false;
  }

  if (fs.existsSync(newDir) && directoryHasContent(newDir)) {
    return false;
  }

  return true;
}

/**
 * Recursively copies the contents of the legacy directory to the new
 * platform-standard path, excluding `secure-store/`. The legacy directory
 * is left untouched so the user can verify the migration before removing it.
 *
 * Uses a two-phase copy (stage → rename) so that a partially written copy
 * never appears at the final destination.
 */
export function performMigration(
  legacyDir: string,
  newDir: string,
): MigrationResult {
  if (!fs.existsSync(legacyDir)) {
    return {
      migrated: false,
      reason: 'legacy dir does not exist',
      filesCopied: 0,
    };
  }

  // Ensure the parent of newDir exists before creating a staging directory inside it.
  fs.mkdirSync(path.dirname(newDir), { recursive: true });

  const stagingDir = fs.mkdtempSync(
    path.join(path.dirname(newDir), '.llxprt-migration-staging-'),
  );

  try {
    const filesCopied = copyDirFiltered(legacyDir, stagingDir);

    if (filesCopied === 0) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return {
        migrated: false,
        reason: 'no files to migrate (only excluded entries)',
        filesCopied: 0,
      };
    }

    if (fs.existsSync(newDir)) {
      const mergedCount = mergeDirectories(stagingDir, newDir);
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return {
        migrated: true,
        reason: 'migration complete (merged)',
        filesCopied: mergedCount,
      };
    }

    fs.renameSync(stagingDir, newDir);

    return {
      migrated: true,
      reason: 'migration complete',
      filesCopied,
    };
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    logger.error('Migration failed:', error);
    throw error;
  }
}

/**
 * Runs the startup migration check using paths from the {@link Storage}
 * class. Skipped entirely when `LLXPRT_CONFIG_HOME` is set (explicit override).
 */
export function runStartupMigration(): MigrationResult {
  const legacyDir = Storage.getLegacyLlxprtDir();
  const newDir = Storage.getGlobalLlxprtDir();

  if (process.env['LLXPRT_CONFIG_HOME']) {
    return {
      migrated: false,
      reason: 'LLXPRT_CONFIG_HOME override is set; skipping migration',
      filesCopied: 0,
    };
  }

  if (!shouldMigrate(legacyDir, newDir)) {
    if (fs.existsSync(newDir) && directoryHasContent(newDir)) {
      logger.debug(
        'Platform config already populated; skipping migration from legacy path.',
      );
    }
    return { migrated: false, reason: 'no migration needed', filesCopied: 0 };
  }

  logger.debug(`Migrating configuration from ${legacyDir} to ${newDir}…`);

  try {
    const result = performMigration(legacyDir, newDir);
    logMigrationStatus(legacyDir, newDir, result);
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
  newDir: string,
  result: MigrationResult,
): void {
  if (result.migrated) {
    process.stderr.write(
      `Configuration migrated successfully (${result.filesCopied} files copied) ` +
        `to ${newDir}. ` +
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
 * Recursively copies `src` into `dest`, skipping entries listed in
 * {@link EXCLUDED_ENTRIES}. Returns the count of regular files copied.
 * Tracks visited real paths to prevent infinite recursion via symlink cycles.
 */
function copyDirFiltered(
  src: string,
  dest: string,
  visited: Set<string> = new Set(),
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
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_ENTRIES.has(entry.name)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      count += copyDirFiltered(srcPath, destPath, visited);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    } else if (entry.isSymbolicLink()) {
      createSymlinkClone(srcPath, destPath);
      count++;
    }
  }

  return count;
}

/**
 * Creates a symlink at `destPath` mirroring the one at `srcPath`.
 * Relative targets are rebased so they resolve correctly from the new location.
 */
function createSymlinkClone(srcPath: string, destPath: string): void {
  const target = fs.readlinkSync(srcPath);
  if (path.isAbsolute(target)) {
    fs.symlinkSync(target, destPath);
  } else {
    const resolvedTarget = path.resolve(path.dirname(srcPath), target);
    const rebased = path.relative(path.dirname(destPath), resolvedTarget);
    fs.symlinkSync(rebased, destPath);
  }
}

/**
 * Merges `staging` into `dest` file by file, **never overwriting** existing
 * destination files. Used when the destination already exists (e.g. partially
 * populated from a prior interrupted run or concurrent process).
 */
function mergeDirectories(staging: string, dest: string): number {
  let count = 0;
  const entries = fs.readdirSync(staging, { withFileTypes: true });

  for (const entry of entries) {
    const stagingPath = path.join(staging, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      if (pathEntryExists(destPath) && !fs.lstatSync(destPath).isDirectory()) {
        logger.debug(
          `Skipping ${entry.name}: type mismatch (dir vs file) at ${destPath}`,
        );
        continue;
      }
      fs.mkdirSync(destPath, { recursive: true });
      count += mergeDirectories(stagingPath, destPath);
    } else if (entry.isFile() && !pathEntryExists(destPath)) {
      fs.copyFileSync(stagingPath, destPath);
      count++;
    } else if (entry.isSymbolicLink() && !pathEntryExists(destPath)) {
      createSymlinkClone(stagingPath, destPath);
      count++;
    }
  }
  return count;
}
