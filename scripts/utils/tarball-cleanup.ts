/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isErrnoException } from './error-guards.ts';

/**
 * Removes every tarball for `prefix` in `distDir` (#3334).
 *
 * `node:fs` performs no glob expansion: `rmSync(join(dir, '<prefix>-*.tgz'))`
 * looks up that literal filename, finds nothing, and `force: true` swallows
 * the ENOENT. The cleanup was a silent no-op, so a version bump left the
 * previous tarball in `dist/`, where the Dockerfile `COPY ... *.tgz` glob
 * handed both versions to a single `npm install -g`. Enumerate the directory
 * and remove each concrete `<prefix>-<version>.tgz` path instead.
 *
 * A missing `distDir` is tolerated to match the old `force: true` no-op:
 * `build_sandbox.ts --skip-npm-install-build` can run on a fresh checkout
 * before any build has created `dist/`. Any other error propagates.
 */
export function removeTarballs(distDir: string, prefix: string): void {
  let entries: readonly string[];
  try {
    entries = readdirSync(distDir);
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
  for (const entry of entries) {
    if (entry.startsWith(`${prefix}-`) && entry.endsWith('.tgz')) {
      rmSync(join(distDir, entry), { force: true });
    }
  }
}
