/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Finds the bwrap executable on the host's search path and returns its
 * absolute path. The host resolves it once, so the capability probe and the
 * launch run the same file, and a PATH written for the sandbox payload cannot
 * change which bwrap the host starts.
 */
export function resolveBwrapExecutable(
  searchPath: string | undefined = process.env.PATH,
): string | undefined {
  for (const entry of (searchPath ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(entry)) continue;
    const candidate = path.join(entry, 'bwrap');
    if (isExecutableFile(candidate)) return candidate;
  }
  return undefined;
}
