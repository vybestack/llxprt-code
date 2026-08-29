/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { join } from 'node:path';
import { resolveGlobalDataDir } from '@vybestack/llxprt-code-storage/config/path-resolver.js';

export const INSTALLED_MEMPROFILE_DIR_NAME = 'memprofile';

export function resolveInstalledMemprofileRoot(
  dataRoot: string = resolveGlobalDataDir(),
): string {
  return join(dataRoot, INSTALLED_MEMPROFILE_DIR_NAME);
}
