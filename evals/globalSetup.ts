/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Unset NO_COLOR environment variable to ensure consistent theme behavior between local and CI test runs
if (process.env['NO_COLOR'] !== undefined) {
  delete process.env['NO_COLOR'];
}

import { mkdir, readdir, rm, mkdtemp } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STORAGE_ENV_KEYS,
  STORAGE_ENV_SUBDIRECTORIES,
  type StorageEnvKey,
} from '../packages/storage/src/testing/isolateStorageRoots.js';
const { join, dirname } = path;

const __dirname = dirname(fileURLToPath(import.meta.url));

const rootDir = join(__dirname, '..');
const evalsDir = join(rootDir, '.evals');
let runDir = ''; // Make runDir accessible in teardown
let evalsStorageRoot = ''; // Track temp storage root for cleanup
let savedStorageEnv: ReadonlyMap<StorageEnvKey, string | undefined> | undefined;

function restoreStorageEnv(): void {
  if (savedStorageEnv === undefined) {
    return;
  }
  for (const key of STORAGE_ENV_KEYS) {
    const value = savedStorageEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedStorageEnv = undefined;
}

export async function setup(): Promise<void> {
  if (savedStorageEnv !== undefined || evalsStorageRoot !== '') {
    throw new Error('Eval global setup is already active');
  }

  savedStorageEnv = new Map(
    STORAGE_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  try {
    // Isolate ALL storage roots so spawned CLI subprocesses (which inherit
    // process.env) never write into the real user config/data/cache/log dirs.
    evalsStorageRoot = await mkdtemp(
      join(os.tmpdir(), 'llxprt-evals-storage-'),
    );
    for (const key of STORAGE_ENV_KEYS) {
      const storageDir = join(
        evalsStorageRoot,
        STORAGE_ENV_SUBDIRECTORIES[key],
      );
      await mkdir(storageDir, { recursive: true });
      process.env[key] = storageDir;
    }

    runDir = join(evalsDir, `${Date.now()}`);
    await mkdir(runDir, { recursive: true });

    // Clean up old test runs, but keep the latest few for debugging
    try {
      const testRuns = await readdir(evalsDir);
      if (testRuns.length > 5) {
        const oldRuns = testRuns.sort().slice(0, testRuns.length - 5);
        await Promise.all(
          oldRuns.map((oldRun) =>
            rm(join(evalsDir, oldRun), {
              recursive: true,
              force: true,
            }),
          ),
        );
      }
    } catch (e) {
      console.error('Error cleaning up old eval runs:', e);
    }

    process.env['INTEGRATION_TEST_FILE_DIR'] = runDir;
    process.env['TELEMETRY_LOG_FILE'] = join(runDir, 'telemetry.log');
    // Ensure IDE detection doesn't trigger during tests
    delete process.env['TERM_PROGRAM'];

    if (
      process.env['KEEP_OUTPUT'] !== undefined &&
      process.env['KEEP_OUTPUT'] !== ''
    ) {
      console.log(`Keeping output for eval run in: ${runDir}`);
    }
    process.env['VERBOSE'] = process.env['VERBOSE'] ?? 'false';

    console.log(`\nEvals output directory: ${runDir}`);
  } catch (setupError) {
    restoreStorageEnv();
    const currentRunDir = runDir;
    const storageRoot = evalsStorageRoot;
    const cleanupErrors: unknown[] = [];
    for (const cleanupPath of [currentRunDir, storageRoot]) {
      if (cleanupPath === '') {
        continue;
      }
      try {
        await rm(cleanupPath, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    runDir = '';
    evalsStorageRoot = '';
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [setupError, ...cleanupErrors],
        'Eval global setup and cleanup failed',
      );
    }
    throw setupError;
  }
}

export async function teardown(): Promise<void> {
  const cleanupErrors: unknown[] = [];
  const currentRunDir = runDir;
  const storageRoot = evalsStorageRoot;
  restoreStorageEnv();

  // Cleanup the eval run directory unless KEEP_OUTPUT is set
  if (process.env['KEEP_OUTPUT'] !== 'true' && currentRunDir !== '') {
    try {
      await rm(currentRunDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (storageRoot !== '') {
    try {
      await rm(storageRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  runDir = '';
  evalsStorageRoot = '';

  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Eval global teardown failed');
  }
}
