/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import os from 'node:os';

/**
 * Determines whether `childPath` is contained within `parentPath`.
 *
 * Copied (pure, dependency-free) from
 * `@vybestack/llxprt-code-core` `utils/paths.ts` so that the
 * `ide-integration` package has no dependency on `core`.
 */
export function isSubpath(parentPath: string, childPath: string): boolean {
  const isWindows = os.platform() === 'win32';
  const pathModule = isWindows ? path.win32 : path;

  // On Windows, path.relative is case-insensitive. On POSIX, it's case-sensitive.
  const relative = pathModule.relative(parentPath, childPath);

  return (
    !relative.startsWith(`..${pathModule.sep}`) &&
    relative !== '..' &&
    !pathModule.isAbsolute(relative)
  );
}
