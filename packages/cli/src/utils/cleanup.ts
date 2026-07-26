/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { ShellExecutionService } from '@vybestack/llxprt-code-core';
import { FileOutput } from '@vybestack/llxprt-code-telemetry';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  __resetCleanupStateForTesting,
  beginCleanup,
  drainAsyncCleanups,
  drainSyncCleanups,
  isCleanupInProgress,
  registerCleanupFn,
  registerSyncCleanupFn,
} from './cleanup-state.js';

type FileOutputWithOptionalDisposeInstance = typeof FileOutput & {
  disposeInstance?: unknown;
};

export function registerCleanup(fn: (() => void) | (() => Promise<void>)) {
  registerCleanupFn(fn);
}

export function registerSyncCleanup(fn: () => void) {
  registerSyncCleanupFn(fn);
}

export async function runExitCleanup() {
  // Guard against concurrent cleanup if signal handlers fire multiple times
  if (isCleanupInProgress()) return;
  beginCleanup();

  // Tear down any active PTYs first to release FDs/sockets promptly
  try {
    ShellExecutionService.destroyAllPtys();
  } catch {
    // Ignore errors during cleanup.
  }

  // Run sync cleanups first (e.g., stdio restoration)
  drainSyncCleanups(() => {
    // Ignore errors during cleanup.
  });

  await drainAsyncCleanups(() => {
    // Ignore errors during cleanup.
  });

  try {
    const disposeInstance = (
      FileOutput as FileOutputWithOptionalDisposeInstance
    ).disposeInstance;
    if (typeof disposeInstance === 'function') {
      await disposeInstance.call(FileOutput);
    } else {
      const instance = FileOutput.getInstance();
      await instance.dispose();
    }
  } catch {
    // Ignore errors during cleanup.
  }
}

// Re-export the test reset from the state module that owns the state,
// preserving backward compatibility for existing consumers.
export { __resetCleanupStateForTesting } from './cleanup-state.js';

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
