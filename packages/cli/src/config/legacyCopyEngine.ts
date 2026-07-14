/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type DebugLogger } from '@vybestack/llxprt-code-core';
import { hasErrnoCode } from './localFsHelpers.js';

/**
 * Low-level filesystem copy primitives used by the legacy-to-canonical path
 * migration. All helpers are side-effecting (real fs) and push diagnostic
 * strings into the caller-owned `errors` array instead of throwing at the
 * top level, so the orchestrator can continue migrating remaining entries
 * after a single-entry failure.
 *
 * Conventions:
 * - Existing canonical entries always win: files and symlinks use
 *   `COPYFILE_EXCL` / `EEXIST`-tolerant writes so a pre-existing destination
 *   is NEVER overwritten.
 * - Directory cycles (via symlinks) are detected with a `visited` set of
 *   realpath'd directories.
 * - Source file mode is preserved on the destination (best-effort).
 */

/**
 * Returns true when a path exists on the filesystem (any type — file,
 * directory, symlink, including broken symlinks). Uses `lstatSync` so a
 * broken symlink still reports as existing.
 */
export function pathEntryExists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy a single regular file using `COPYFILE_EXCL`. If the destination
 * already exists the copy is silently skipped (returns 0). Mode of the
 * source is preserved on the destination (best-effort).
 */
export function copyFileWithMode(
  srcPath: string,
  destPath: string,
  errors: string[],
  logger: DebugLogger,
): number {
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (hasErrnoCode(error, 'EEXIST')) {
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
    // mode preservation is best-effort
  }
  return 1;
}

/**
 * Dispatch a single filesystem entry (file, directory, or symlink) to the
 * appropriate copy routine. Files and symlinks are skipped when the
 * destination already exists.
 */
export function copyEntry(
  srcPath: string,
  destPath: string,
  legacyRoot: string,
  destRoot: string,
  visited: Set<string>,
  errors: string[],
  logger: DebugLogger,
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
    return createSymlinkClone(
      srcPath,
      destPath,
      legacyRoot,
      destRoot,
      errors,
      logger,
    );
  }

  if (stat.isFile()) {
    if (pathEntryExists(destPath)) {
      return 0;
    }
    return copyFileWithMode(srcPath, destPath, errors, logger);
  }

  if (stat.isDirectory()) {
    return copyDirFiltered(
      srcPath,
      destPath,
      legacyRoot,
      destRoot,
      visited,
      errors,
      logger,
    );
  }

  return 0;
}

/**
 * Recursively copy a directory tree, skipping files/symlinks whose
 * destination already exists. Detects symlink cycles via `visited`.
 */
export function copyDirFiltered(
  src: string,
  dest: string,
  legacyRoot: string,
  destRoot: string,
  visited: Set<string>,
  errors: string[],
  logger: DebugLogger,
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
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch (error) {
    errors.push(`${dest}: ${String(error)}`);
    logger.debug(`Cannot create directory ${dest}: ${String(error)}`);
    return count;
  }
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
        logger,
      );
    } else if (entry.isFile() && !pathEntryExists(destPath)) {
      count += copyFileWithMode(srcPath, destPath, errors, logger);
    } else if (entry.isSymbolicLink() && !pathEntryExists(destPath)) {
      count += createSymlinkClone(
        srcPath,
        destPath,
        legacyRoot,
        destRoot,
        errors,
        logger,
      );
    }
  }

  return count;
}

/**
 * Like {@link copyDirFiltered} but delegates each regular file copy to
 * `fileInterceptor` instead of the raw `copyFileWithMode`. This allows the
 * profiles directory to normalize files before exclusive-create. Symlinks and
 * subdirectories fall through to the standard filtered copy.
 */
export function copyDirFilteredWithInterceptor(
  src: string,
  dest: string,
  legacyRoot: string,
  destRoot: string,
  visited: Set<string>,
  errors: string[],
  fileInterceptor: (srcPath: string, destPath: string) => number,
  logger: DebugLogger,
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
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch (error) {
    errors.push(`${dest}: ${String(error)}`);
    logger.debug(`Cannot create directory ${dest}: ${String(error)}`);
    return count;
  }
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
      count += copyDirFilteredWithInterceptor(
        srcPath,
        destPath,
        legacyRoot,
        destRoot,
        visited,
        errors,
        fileInterceptor,
        logger,
      );
    } else if (entry.isFile() && !pathEntryExists(destPath)) {
      try {
        count += fileInterceptor(srcPath, destPath);
      } catch (error) {
        errors.push(`${srcPath}: ${String(error)}`);
        logger.debug(`Interceptor failed for '${srcPath}': ${String(error)}`);
      }
    } else if (entry.isSymbolicLink() && !pathEntryExists(destPath)) {
      count += createSymlinkClone(
        srcPath,
        destPath,
        legacyRoot,
        destRoot,
        errors,
        logger,
      );
    }
  }

  return count;
}

/**
 * Create a symlink at `destPath` that mirrors the intent of the symlink at
 * `srcPath`. Absolute targets that point inside the legacy root are rebased
 * into the new root; relative targets are resolved and rebased when they
 * land inside the legacy root, otherwise copied verbatim.
 */
export function createSymlinkClone(
  srcPath: string,
  destPath: string,
  legacyRoot: string,
  newRoot: string,
  errors: string[],
  logger: DebugLogger,
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
      if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
        fs.symlinkSync(path.join(newRoot, rel), destPath);
      } else {
        fs.symlinkSync(target, destPath);
      }
    } else {
      const resolvedTarget = path.resolve(path.dirname(srcPath), target);
      const relFromLegacy = path.relative(legacyRoot, resolvedTarget);
      if (relFromLegacy.startsWith('..') || path.isAbsolute(relFromLegacy)) {
        fs.symlinkSync(target, destPath);
      } else {
        const newTarget = path.join(newRoot, relFromLegacy);
        const rebased = path.relative(path.dirname(destPath), newTarget);
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
