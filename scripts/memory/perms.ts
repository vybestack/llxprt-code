/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Owner-only file and directory permissions for sensitive profiling artifacts.
 *
 * Heap snapshots, samples, and logs can contain full prompts, tool output, and
 * credentials. On POSIX these live in 0700 directories and 0600 files so no
 * other local user can read them.
 *
 * Creation `mode` options only apply when a path is first created, so every
 * reused directory must be re-tightened explicitly: `ensureSecureDir` creates
 * OR tightens to 0700, and `secureFile` tightens an existing file to 0600.
 * A tighten failure throws (fail fast) rather than leaving a permissive
 * artifact in place silently.
 *
 * On Windows the `mode` parameter is ignored by Node.js (it does not call
 * chmod), so passing these values is harmless — there is no Windows-incompatible
 * chmod behaviour. Explicit `chmodSync` calls are guarded by `isPosixPlatform()`
 * so they never execute on Windows.
 */

import { chmodSync, mkdirSync } from 'node:fs';
import { platform } from 'node:os';

/** Directory mode: owner read/write/execute only (POSIX). */
export const DIR_MODE = 0o700;

/** File mode: owner read/write only (POSIX). */
export const FILE_MODE = 0o600;

const IS_POSIX = platform() !== 'win32';

/** True on macOS, Linux, and other POSIX systems; false on Windows. */
export function isPosixPlatform(): boolean {
  return IS_POSIX;
}

/**
 * Applies owner-only file permissions on POSIX. No-op on Windows where the
 * underlying ACL model does not use POSIX mode bits.
 *
 * Used after operations that create files outside our direct control (e.g.
 * `writeHeapSnapshot` from `node:v8`), which do not accept a `mode` option.
 */
export function secureFile(path: string): void {
  if (IS_POSIX) {
    chmodSync(path, FILE_MODE);
  }
}

/**
 * Creates a directory (with parents) if needed and tightens it — including a
 * pre-existing one left permissive by an earlier run or another tool — to
 * owner-only 0700 on POSIX. On Windows only the mkdir applies.
 */
export function ensureSecureDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIR_MODE });
  if (IS_POSIX) {
    chmodSync(path, DIR_MODE);
  }
}
