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
 * @returns The temp root path (mainly for assertions in behavioral tests).
 */
export function isolateStorageRoots(): string {
  if (process.env[ISOLATION_MARKER]) {
    const configHome = process.env.LLXPRT_CONFIG_HOME;
    if (configHome) {
      return path.dirname(configHome);
    }
  }

  const testStorageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'llxprt-test-storage-'),
  );

  const configDir = path.join(testStorageRoot, 'config');
  const dataDir = path.join(testStorageRoot, 'data');
  const cacheDir = path.join(testStorageRoot, 'cache');
  const logDir = path.join(testStorageRoot, 'log');

  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  process.env.LLXPRT_CONFIG_HOME = configDir;
  process.env.LLXPRT_DATA_HOME = dataDir;
  process.env.LLXPRT_CACHE_HOME = cacheDir;
  process.env.LLXPRT_LOG_HOME = logDir;
  process.env[ISOLATION_MARKER] = '1';

  return testStorageRoot;
}
