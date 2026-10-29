/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getIdeProcessInfo } from './process-utils.js';

let resolved: ReturnType<typeof getIdeProcessInfo> | undefined;

/**
 * The ancestry of this process is fixed for its lifetime, but resolving it
 * costs a synchronous `ps` walk on POSIX and a full PowerShell process-table
 * query on Windows. Every client created in the process shares one lookup.
 */
export function cachedProcessInfo(): ReturnType<typeof getIdeProcessInfo> {
  resolved ??= getIdeProcessInfo();
  return resolved;
}

export function resetProcessInfo(): void {
  resolved = undefined;
}
