/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fail-fast path canonicalization for sandbox launch preparation (#3475).
 *
 * Every sandbox path that must be resolved to its real filesystem identity
 * before launch — the workspace root, the running executable, tmpdir,
 * seatbelt target/include directories, and mount sources — goes through
 * this module. A path that another process removes or replaces between its
 * discovery and `realpath` resolution, a symlink cycle, or a malformed path
 * fails as a `FatalSandboxError` naming the affected path and the sandbox
 * operation being performed, instead of escaping as an unclassified
 * filesystem error.
 *
 * There is deliberately no lexical fallback: a path that cannot be resolved
 * against the real filesystem would weaken every containment check built on
 * the canonical result.
 */

import fs from 'node:fs';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';

/**
 * The bounded filesystem seam: exactly the two primitives canonicalization
 * needs. Tests substitute implementations to exercise discovery-then-
 * resolution races deterministically; production always uses Node's fs.
 */
export interface SandboxPathFilesystem {
  existsSync(targetPath: string): boolean;
  realpathSync(targetPath: string): string;
}

const NODE_FILESYSTEM: SandboxPathFilesystem = {
  existsSync: (targetPath) => fs.existsSync(targetPath),
  realpathSync: (targetPath) => fs.realpathSync(targetPath),
};

/** True when `error` or its recorded cause carries the errno `code`. */
export function hasFilesystemErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false;
  const candidates: unknown[] = [error, error.cause];
  return candidates.some(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      'code' in candidate &&
      candidate.code === code,
  );
}

/**
 * Canonicalizes a path that must already exist. Any filesystem failure —
 * concurrent removal or replacement, a symlink cycle, a malformed path — is
 * converted into a `FatalSandboxError` naming `targetPath` and the sandbox
 * `operation` being performed. The underlying error is recorded as the
 * thrown error's `cause` for errno inspection by callers.
 */
export function canonicalizeExistingPath(
  targetPath: string,
  operation: string,
  filesystem: SandboxPathFilesystem = NODE_FILESYSTEM,
): string {
  try {
    return filesystem.realpathSync(targetPath);
  } catch (cause) {
    throw sandboxCanonicalizationError(operation, targetPath, cause);
  }
}

/**
 * Resolves `candidate` against the real filesystem: the nearest EXISTING
 * ancestor is canonicalized and the (possibly empty) not-yet-existing tail
 * is appended. The result identifies the directory a path will really
 * occupy, following symlinks that already exist while keeping support for
 * missing contained destinations.
 *
 * A path that discovery saw exist but whose canonical resolution then fails
 * (concurrent removal or replacement) is a fatal sandbox preparation error
 * naming that path — never a lexical fallback.
 */
export function canonicalizeNearestExistingPath(
  candidate: string,
  operation: string,
  filesystem: SandboxPathFilesystem = NODE_FILESYSTEM,
): string {
  const tail: string[] = [];
  let current = candidate;
  for (;;) {
    if (filesystem.existsSync(current)) {
      return path.join(
        canonicalizeExistingPath(current, operation, filesystem),
        ...tail.reverse(),
      );
    }
    const parent = path.dirname(current);
    if (parent === current) {
      // Reached the filesystem root without an existing ancestor.
      return candidate;
    }
    tail.push(path.basename(current));
    current = parent;
  }
}

function sandboxCanonicalizationError(
  operation: string,
  targetPath: string,
  cause: unknown,
): FatalSandboxError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const error = new FatalSandboxError(
    `Failed to ${operation}: canonical path resolution of '${targetPath}' ` +
      `failed (${detail}). Another process may have removed or replaced the ` +
      `path while the sandbox was preparing, or the path may be malformed or ` +
      `a symlink cycle. Verify the path and retry.`,
  );
  error.cause = cause;
  return error;
}
