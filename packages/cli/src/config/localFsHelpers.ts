/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Local filesystem helpers for CLI config modules (profileRepair,
 * pathMigration, legacyProfileNormalization). These avoid depending on
 * settings-internal lock/path/read/temp exports, keeping the settings root
 * API minimal.
 */

// ─── Structural error guard ─────────────────────────────────────────────────

export interface ErrnoError {
  readonly code?: string;
  readonly message: string;
}

/**
 * Structural guard for Node.js filesystem errors that carry a `code`
 * property. Avoids `as NodeJS.ErrnoException` type assertions.
 */
export function hasErrnoCode(
  error: unknown,
  expectedCode: string,
): error is ErrnoError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === expectedCode
  );
}

// ─── File existence ─────────────────────────────────────────────────────────

export function pathEntryExists(p: string): boolean {
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

// ─── Discriminated file read ────────────────────────────────────────────────

export type ReadResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'content'; readonly content: string }
  | { readonly kind: 'error'; readonly error: Error };

export function readFileSync(filePath: string): ReadResult {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return { kind: 'absent' };
    }
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      kind: 'error',
    };
  }
  return { content, kind: 'content' };
}

// ─── Unique temp path ───────────────────────────────────────────────────────

export function uniqueTempPath(
  dir: string,
  baseFileName: string,
  suffix: string,
): string {
  const random = crypto.randomUUID();
  return path.join(dir, `${baseFileName}.${process.pid}.${random}${suffix}`);
}

// ─── Fsync helper ───────────────────────────────────────────────────────────

export function fsyncFileSync(filePath: string): void {
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // best-effort close
    }
  }
}

/**
 * Known errno codes where directory fsync is unsupported (primarily Windows
 * and some network filesystems). These are the ONLY errors swallowed by
 * {@link fsyncDirSync}; all other errors propagate so that genuine I/O
 * failures (e.g. ENOSPC, EIO) are not silently hidden (#5).
 */
const DIR_FSYNC_UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  'EINVAL',
  'ENOSYS',
  'EPERM',
  'ENOTSUP',
]);

/**
 * Fsync of a directory path (sync). On Linux and macOS, `fsyncSync` on a
 * directory fd flushes directory entry changes so renames, creates, and
 * unlinks are durable. On Windows and some network filesystems, directory
 * fsync is unsupported and throws — those known-unsupported errno codes are
 * silently ignored (#5).
 *
 * All other errors (ENOSPC, EIO, EACCES, etc.) PROPAGATE to the caller so
 * genuine I/O failures are not silently hidden. Durability is NOT best-effort
 * for real errors — callers must know when the filesystem is unhealthy.
 */
export function fsyncDirSync(dirPath: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dirPath, 'r');
    fs.fsyncSync(fd);
  } catch (error) {
    if (!isDirFsyncUnsupported(error)) {
      throw error;
    }
    // Directory fsync is unsupported on this platform (e.g. Windows).
    // Silently ignore — the file-level fsync still applies.
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort close
      }
    }
  }
}

/**
 * Determine whether a directory-fsync error is a known unsupported-platform
 * code that should be silently ignored (#5).
 */
function isDirFsyncUnsupported(error: unknown): boolean {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return DIR_FSYNC_UNSUPPORTED_CODES.has(error.code);
  }
  return false;
}

// ─── Marker version guard ───────────────────────────────────────────────────

/**
 * Structural guard for the migration/repair marker JSON. Parses and
 * validates that `version` is a number, avoiding `as { version?: number }`
 * type assertions.
 */
export function markerVersionAtLeast(
  rawJson: string,
  minVersion: number,
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return false;
  }
  if (!isPlainObject(parsed)) {
    return false;
  }
  const version = parsed['version'];
  return typeof version === 'number' && version >= minVersion;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
