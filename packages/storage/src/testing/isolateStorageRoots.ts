/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const ISOLATION_MARKER = 'LLXPRT_TEST_STORAGE_ISOLATED';

/**
 * Isolates ALL storage roots to a per-run temp directory so tests can never
 * write into the real user config/data/cache/log dirs.
 *
 * Sets LLXPRT_CONFIG_HOME, LLXPRT_DATA_HOME, LLXPRT_CACHE_HOME, and
 * LLXPRT_LOG_HOME to subdirectories under a unique temp root, then marks
 * isolation with LLXPRT_TEST_STORAGE_ISOLATED so repeated calls in the same
 * process are no-ops.
 *
 * Storage.getGlobal*Dir() reads these env vars at call time, and CLI
 * subprocesses spawned by integration tests inherit process.env, so setting
 * them here covers both in-process and subprocess writes.
 *
 * Cleanup: The temp directory is intentionally not cleaned up by this
 * function because vitest workers are short-lived processes. The OS
 * reclaims `os.tmpdir()` contents on reboot, and CI runners are
 * ephemeral. Tests that need deterministic cleanup should call
 * `fs.rmSync(testStorageRoot, { recursive: true, force: true })`
 * using the returned path.
 *
 * @returns The temp root path (mainly for assertions in behavioral tests).
 */
export function isolateStorageRoots(): string {
  if (process.env[ISOLATION_MARKER]) {
    const configHome = process.env.LLXPRT_CONFIG_HOME;
    if (configHome && path.isAbsolute(configHome)) {
      return path.dirname(configHome);
    }
  }

  let testStorageRoot: string;
  try {
    testStorageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-test-storage-'),
    );
  } catch (e) {
    throw new Error(
      `Failed to create isolated test storage root: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const subdirs: Record<string, string> = {
    config: path.join(testStorageRoot, 'config'),
    data: path.join(testStorageRoot, 'data'),
    cache: path.join(testStorageRoot, 'cache'),
    log: path.join(testStorageRoot, 'log'),
  };

  try {
    for (const dir of Object.values(subdirs)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    throw new Error(
      `Failed to create isolated test storage subdirectories: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  process.env.LLXPRT_CONFIG_HOME = subdirs.config;
  process.env.LLXPRT_DATA_HOME = subdirs.data;
  process.env.LLXPRT_CACHE_HOME = subdirs.cache;
  process.env.LLXPRT_LOG_HOME = subdirs.log;
  process.env[ISOLATION_MARKER] = '1';

  return testStorageRoot;
}
