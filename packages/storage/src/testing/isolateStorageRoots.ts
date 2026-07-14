/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

const ISOLATION_MARKER = 'LLXPRT_TEST_STORAGE_ISOLATED';

export const STORAGE_ENV_KEYS = [
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
] as const;

export type StorageEnvKey = (typeof STORAGE_ENV_KEYS)[number];

export const STORAGE_ENV_SUBDIRECTORIES: Readonly<
  Record<StorageEnvKey, string>
> = {
  LLXPRT_CONFIG_HOME: 'config',
  LLXPRT_DATA_HOME: 'data',
  LLXPRT_CACHE_HOME: 'cache',
  LLXPRT_LOG_HOME: 'log',
};

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
    if (configHome === undefined || !path.isAbsolute(configHome)) {
      throw new Error(
        'Isolated test storage marker is set without an absolute LLXPRT_CONFIG_HOME',
      );
    }

    const testStorageRoot = path.dirname(configHome);
    for (const key of STORAGE_ENV_KEYS) {
      const value = process.env[key];
      const expected = path.join(
        testStorageRoot,
        STORAGE_ENV_SUBDIRECTORIES[key],
      );
      if (
        value === undefined ||
        path.resolve(value) !== path.resolve(expected)
      ) {
        throw new Error(
          `Isolated test storage marker is set with an inconsistent ${key}`,
        );
      }
    }
    return testStorageRoot;
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

  try {
    for (const key of STORAGE_ENV_KEYS) {
      fs.mkdirSync(
        path.join(testStorageRoot, STORAGE_ENV_SUBDIRECTORIES[key]),
        { recursive: true },
      );
    }
  } catch (e) {
    try {
      fs.rmSync(testStorageRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [e, cleanupError],
        'Failed to create and clean up isolated test storage',
      );
    }
    throw new Error(
      `Failed to create isolated test storage subdirectories: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  for (const key of STORAGE_ENV_KEYS) {
    process.env[key] = path.join(
      testStorageRoot,
      STORAGE_ENV_SUBDIRECTORIES[key],
    );
  }
  process.env[ISOLATION_MARKER] = '1';

  return testStorageRoot;
}
