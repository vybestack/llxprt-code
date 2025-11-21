/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { Storage } from '@vybestack/llxprt-code-core';

const cleanupFunctions: Array<(() => void) | (() => Promise<void>)> = [];
let cleanupInProgress = false;

export function registerCleanup(fn: (() => void) | (() => Promise<void>)) {
  cleanupFunctions.push(fn);
}

export async function runExitCleanup() {
  // Guard against concurrent cleanup if signal handlers fire multiple times
  if (cleanupInProgress) return;
  cleanupInProgress = true;

  for (const fn of cleanupFunctions) {
    try {
      await fn();
    } catch (_) {
      // Ignore errors during cleanup.
    }
  }
  cleanupFunctions.length = 0; // Clear the array
}

/**
 * Reset cleanup state for testing purposes only.
 * DO NOT use this in production code.
 * @internal
 */
export function __resetCleanupStateForTesting() {
  cleanupFunctions.length = 0;
  cleanupInProgress = false;
}

export async function cleanupCheckpoints() {
  const storage = new Storage(process.cwd());
  const tempDir = storage.getProjectTempDir();
  const checkpointsDir = join(tempDir, 'checkpoints');
  try {
    await fs.rm(checkpointsDir, { recursive: true, force: true });
  } catch {
    // Ignore errors if the directory doesn't exist or fails to delete.
  }
}
