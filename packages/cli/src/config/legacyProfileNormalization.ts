/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import {
  parseProfile,
  isLoadBalancerProfile,
  withProfilesLockSync,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import { type DebugLogger } from '@vybestack/llxprt-code-core';
import {
  hasErrnoCode,
  pathEntryExists,
  readFileSync as readLocalFileSync,
  fsyncFileSync,
  fsyncDirSync,
} from './localFsHelpers.js';
import {
  copyDirFilteredWithInterceptor,
  copyFileWithMode,
  createSymlinkClone,
} from './legacyCopyEngine.js';

/**
 * Profile normalization for the legacy-to-canonical path migration copy phase.
 *
 * During migration, legacy profile files DIRECTLY under `profiles/` (top-level
 * `.json` only) are normalized (missing `modelParams` → `modelParams: {}`) and
 * atomically published with NO REPLACE. Nested directories and non-json files
 * are copied byte-for-byte via the standard COPYFILE_EXCL copy. Existing
 * canonical always wins.
 *
 * Atomic publication: normalized/validated content is written to a unique
 * exclusive same-directory temp, fsync'd/closed, then published via hard-link
 * (`linkSync`, fails EEXIST atomically) then unlink temp. Since same
 * directory/filesystem, no partial final is ever visible. If hard links are
 * unsupported, an error is reported (no fallback to overwriting).
 *
 * The shared profiles lock is held around the entire normalization copy
 * publication so that no concurrent ProfileManager save can interleave.
 */

/**
 * Copy a legacy `profiles/` directory to the canonical location. Top-level
 * `.json` files are normalized+validated and atomically published under the
 * shared profiles lock. Nested directories and non-json files fall through to
 * the standard COPYFILE_EXCL byte-for-byte copy (coordinated by the lock for
 * the directory-level entries).
 */
export function copyProfilesDirNormalized(
  srcProfilesDir: string,
  destProfilesDir: string,
  visited: Set<string>,
  errors: string[],
  logger: DebugLogger,
): number {
  let realSrc: string;
  try {
    realSrc = fs.realpathSync(srcProfilesDir);
  } catch (error) {
    errors.push(`${srcProfilesDir}: ${String(error)}`);
    logger.debug(
      `Skipping inaccessible profiles dir (broken symlink?): ${srcProfilesDir}: ${String(error)}`,
    );
    return 0;
  }
  if (visited.has(realSrc)) {
    logger.debug(
      `Skipping already-visited profiles dir (symlink cycle): ${srcProfilesDir}`,
    );
    return 0;
  }
  visited.add(realSrc);

  // Hold the shared profiles lock around the entire normalization publication
  // so no concurrent ProfileManager save can interleave. Sync repair uses the
  // same O_EXCL lock artifact (.profiles.lock), so they serialize on the same
  // target.
  try {
    return withProfilesLockSync(destProfilesDir, () =>
      doCopyProfilesDirNormalized(
        srcProfilesDir,
        destProfilesDir,
        visited,
        errors,
        logger,
      ),
    );
  } catch (error) {
    errors.push(
      `${destProfilesDir}: lock acquisition failed: ${String(error)}`,
    );
    logger.debug(
      `Could not acquire profiles lock for normalization: ${String(error)}`,
    );
    return 0;
  }
}

function doCopyProfilesDirNormalized(
  srcProfilesDir: string,
  destProfilesDir: string,
  visited: Set<string>,
  errors: string[],
  logger: DebugLogger,
): number {
  let count = 0;
  fs.mkdirSync(destProfilesDir, { recursive: true });
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(srcProfilesDir, { withFileTypes: true });
  } catch (error) {
    errors.push(`${srcProfilesDir}: ${String(error)}`);
    logger.debug(`Cannot read directory ${srcProfilesDir}: ${String(error)}`);
    return 0;
  }

  for (const entry of entries) {
    const srcPath = path.join(srcProfilesDir, entry.name);
    const destPath = path.join(destProfilesDir, entry.name);
    count += copyProfileEntry(
      entry,
      srcPath,
      destPath,
      srcProfilesDir,
      destProfilesDir,
      visited,
      errors,
      logger,
    );
  }

  return count;
}

function copyProfileEntry(
  entry: fs.Dirent,
  srcPath: string,
  destPath: string,
  legacyRoot: string,
  destRoot: string,
  visited: Set<string>,
  errors: string[],
  logger: DebugLogger,
): number {
  if (entry.isDirectory()) {
    // Nested directories copy byte-for-byte (no normalization).
    return copyNestedDirectory(
      srcPath,
      destPath,
      legacyRoot,
      destRoot,
      visited,
      errors,
      logger,
    );
  }
  if (entry.isFile() && entry.name.endsWith('.json')) {
    // Top-level .json file: try normalization, fall back to raw copy.
    return publishNormalizedOrRaw(srcPath, destPath, errors, logger);
  }
  if (entry.isFile()) {
    // Non-json top-level file: byte-for-byte copy.
    if (!pathEntryExists(destPath)) {
      return copyFileWithMode(srcPath, destPath, errors, logger);
    }
    return 0;
  }
  if (entry.isSymbolicLink() && !pathEntryExists(destPath)) {
    return createSymlinkClone(
      srcPath,
      destPath,
      legacyRoot,
      destRoot,
      errors,
      logger,
    );
  }
  return 0;
}

/**
 * Publish a single top-level `.json` profile file. If the file normalizes to a
 * valid standard profile, write the normalized bytes atomically (hard-link,
 * NO REPLACE). Otherwise (LB, invalid JSON, non-profile), fall back to raw
 * COPYFILE_EXCL. Existing canonical always wins (EEXIST → skip).
 */
function publishNormalizedOrRaw(
  srcPath: string,
  destPath: string,
  errors: string[],
  logger: DebugLogger,
): number {
  if (pathEntryExists(destPath)) {
    return 0;
  }
  const normalized = normalizeLegacyProfileBytes(srcPath);
  if (normalized !== null) {
    try {
      return publishNormalizedExclusive(srcPath, destPath, normalized);
    } catch (error) {
      errors.push(`${srcPath}: ${String(error)}`);
      logger.debug(
        `Normalized publish failed for '${srcPath}': ${String(error)}`,
      );
      return 0;
    }
  }
  // Non-normalizable file — fall back to raw COPYFILE_EXCL copy.
  return copyFileWithMode(srcPath, destPath, errors, logger);
}

/**
 * Atomically publish normalized content to `destPath` with NO REPLACE.
 *
 * Writes normalized/validated content to a unique exclusive same-directory
 * temp (wx), fsync/close, then hard-link temp to final (`linkSync`, fails
 * EEXIST atomically), then unlink temp. Since same directory/filesystem, no
 * partial final is visible. Preserves source mode. If hard links are
 * unsupported, reports an error (no fallback to overwriting).
 *
 * If the destination already exists (EEXIST on link), the temp is cleaned up
 * and 0 is returned (existing canonical wins).
 */
function publishNormalizedExclusive(
  srcPath: string,
  destPath: string,
  normalizedContent: string,
): number {
  const dir = path.dirname(destPath);
  const base = path.basename(destPath);
  const tmpPath = uniqueTempName(dir, base);

  let srcMode = 0o644;
  try {
    srcMode = fs.statSync(srcPath).mode & 0o777;
  } catch {
    // default mode
  }

  try {
    fs.writeFileSync(tmpPath, normalizedContent, {
      encoding: 'utf-8',
      mode: srcMode,
      flag: 'wx',
    });

    // fsync the temp before publishing so the content is durable.
    fsyncFileSync(tmpPath);

    // Atomically publish: hard-link temp → final. linkSync fails EEXIST
    // atomically if final already exists. No partial final is ever visible
    // because the link is atomic on the same filesystem.
    try {
      fs.linkSync(tmpPath, destPath);
    } catch (error) {
      if (hasErrnoCode(error, 'EEXIST')) {
        return 0;
      }
      if (hasErrnoCode(error, 'ENOSYS') || hasErrnoCode(error, 'EPERM')) {
        // Hard links unsupported. Report error — do NOT fall back to
        // overwriting (crash-safety invariant).
        throw new Error(
          `hard-link publish unsupported for ${destPath} (${error.code}); cannot safely publish normalized profile`,
        );
      }
      throw error;
    }
    // fsync parent directory after link for durability of the directory
    // entry update (best-effort on platforms that support it).
    fsyncDirSync(dir);
    return 1;
  } finally {
    if (pathEntryExists(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }
  }
}

/**
 * Read a legacy profile JSON, parse it through the shared parseProfile
 * boundary (which normalizes missing modelParams to {} for standard version 1
 * profiles per directive #6), and return the serialized canonical normalized
 * JSON if it is a valid standard profile.
 * Returns null for load-balancer profiles, invalid JSON, or non-profile data
 * (those are copied raw by the caller).
 */
function normalizeLegacyProfileBytes(legacyPath: string): string | null {
  const readResult = readLocalFileSync(legacyPath);
  if (readResult.kind !== 'content') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readResult.content);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed)) {
    return null;
  }
  if (parsed.type === 'loadbalancer') {
    return null;
  }

  let profile: Profile;
  try {
    // parseProfile normalizes missing modelParams → {} at the shared boundary.
    profile = parseProfile(parsed);
  } catch {
    return null;
  }
  if (isLoadBalancerProfile(profile)) {
    return null;
  }

  // Serialize the validated normalized profile so this migration remains
  // aligned with the shared profile parsing boundary.
  return JSON.stringify(profile, null, 2);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Copy a nested subdirectory under profiles byte-for-byte (no normalization).
 * Uses the standard filtered copy so existing canonical entries always win.
 */
function copyNestedDirectory(
  src: string,
  dest: string,
  legacyRoot: string,
  destRoot: string,
  visited: Set<string>,
  errors: string[],
  logger: DebugLogger,
): number {
  return copyDirFilteredWithInterceptor(
    src,
    dest,
    legacyRoot,
    destRoot,
    visited,
    errors,
    (s, d) => copyFileWithMode(s, d, errors, logger),
    logger,
  );
}

function uniqueTempName(dir: string, base: string): string {
  const random = crypto.randomUUID();
  return path.join(dir, `${base}.${process.pid}.${random}.norm.tmp`);
}
