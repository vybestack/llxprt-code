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
 * Shared safety primitives for the session-recording janitor and lock manager.
 *
 * These helpers prevent path-traversal, symlink-redirect, and unsafe-session-ID
 * attacks by validating the canonical safe session-ID grammar, guaranteeing
 * that lock paths are direct children of the chats directory, verifying path
 * containment, and inspecting file identity with `lstat` (never following
 * symlinks).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Canonical safe session-ID grammar.
 *
 * Permits uppercase/lowercase letters, digits, dashes, and underscores only.
 * Explicitly rejects dots (preventing `..` traversal), path separators,
 * whitespace, and control characters.  This is intentionally more restrictive
 * than a "looks like a UUID" check so that legacy and test identifiers
 * (`session-abc_123`) remain valid while any path-like component is excluded.
 *
 * The maximum length of 256 is far above any real identifier (UUIDs are 36
 * characters) yet small enough to reject absurd values.
 */

/** Maximum allowed session-ID length (single source of truth). */
const SAFE_SESSION_ID_MAX_LENGTH = 256;

export const SAFE_SESSION_ID_RE = new RegExp(
  `^[A-Za-z0-9_-]{1,${SAFE_SESSION_ID_MAX_LENGTH}}$`,
);

/**
 * Return `true` when `id` matches the canonical safe session-ID grammar.
 *
 * Any unsafe/path-like identifier (containing dots, slashes, backslashes,
 * whitespace, or control characters) is rejected.  Callers use this to make
 * unsafe recordings unreadable/protected and to guarantee lock paths never
 * escape the chats directory.
 */
export function isValidSafeSessionId(id: string): boolean {
  return SAFE_SESSION_ID_RE.test(id);
}

/**
 * Normalize a path for comparison by resolving `.` and `..` segments without
 * touching the filesystem.  This is used purely for lexical containment
 * checks so that traversal segments are collapsed before comparison.
 *
 * A trailing separator is stripped from non-root paths so prefix-based
 * containment checks work correctly when the parent path ends with a
 * separator, while filesystem roots remain intact.
 */
function normalizeLexical(p: string): string {
  const normalized = path.normalize(p);
  if (
    normalized !== path.parse(normalized).root &&
    normalized.endsWith(path.sep)
  ) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Return `true` when `childPath` is a direct child file of `parentDir`.
 *
 * A direct child has no intermediate directory between itself and the parent.
 * Path-traversal segments (`..`) are collapsed and rejected.
 */
export function isDirectChildPath(
  parentDir: string,
  childPath: string,
): boolean {
  const normalizedParent = normalizeLexical(parentDir);
  const normalizedChild = normalizeLexical(childPath);
  const parentWithSep = normalizedParent + path.sep;
  if (!normalizedChild.startsWith(parentWithSep)) return false;
  const remainder = normalizedChild.slice(parentWithSep.length);
  // Reject any remaining path separators — must be a direct child.
  return !remainder.includes(path.sep) && remainder.length > 0;
}

/**
 * Return `true` when `childPath` is equal to or nested inside `parentDir`.
 *
 * Uses lexical normalization to collapse traversal segments.  A path that
 * merely prefixes the parent name (e.g. `/tmp/root` vs `/tmp/root-evil`) is
 * correctly rejected.
 */
export function isPathContainedIn(
  parentDir: string,
  childPath: string,
): boolean {
  const normalizedParent = normalizeLexical(parentDir);
  const normalizedChild = normalizeLexical(childPath);
  if (normalizedChild === normalizedParent) return true;
  return normalizedChild.startsWith(normalizedParent + path.sep);
}

/**
 * Assert that `lockPath` is a safe direct child of `chatsDir`.
 *
 * @throws {Error} when the lock path escapes the chats directory or is not a
 *                 direct child.
 */
export function assertSafeLockPath(chatsDir: string, lockPath: string): void {
  if (!isDirectChildPath(chatsDir, lockPath)) {
    throw new Error(
      `Unsafe lock path "${lockPath}" is not a direct child of "${chatsDir}"`,
    );
  }
}

/**
 * Return `true` when the path exists and is a regular file that is **not** a
 * symlink, using `lstat` so symlinks are never followed.
 */
export async function isRegularNonSymlinkFile(
  filePath: string,
): Promise<boolean> {
  try {
    const stat = await fs.lstat(filePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Return `true` when the path exists and is a directory that is **not** a
 * symlink, using `lstat` so symlinked directories are rejected.
 */
export async function isRegularNonSymlinkDir(
  dirPath: string,
): Promise<boolean> {
  try {
    const stat = await fs.lstat(dirPath);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}
