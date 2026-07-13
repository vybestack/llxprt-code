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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';

// Handle the case where import.meta.url might be undefined in CI
const __dirname = import.meta?.url
  ? dirname(fileURLToPath(import.meta.url))
  : path.resolve(process.cwd(), 'evals');

const rootDir = join(__dirname, '..');
const evalsDir = join(rootDir, '.evals');
let runDir = ''; // Make runDir accessible in teardown
let evalsStorageRoot = ''; // Track temp storage root for cleanup
let savedStorageEnv: Record<string, string | undefined> = {};

export async function setup() {
  // Isolate ALL storage roots so spawned CLI subprocesses (which inherit
  // process.env) never write into the real user config/data/cache/log dirs.
  evalsStorageRoot = await mkdtemp(
    path.join(os.tmpdir(), 'llxprt-evals-storage-'),
  );
  const storageSubdirs = ['config', 'data', 'cache', 'log'];
  for (const sub of storageSubdirs) {
    await mkdir(join(evalsStorageRoot, sub), { recursive: true });
  }
  savedStorageEnv = {
    LLXPRT_CONFIG_HOME: process.env.LLXPRT_CONFIG_HOME,
    LLXPRT_DATA_HOME: process.env.LLXPRT_DATA_HOME,
    LLXPRT_CACHE_HOME: process.env.LLXPRT_CACHE_HOME,
    LLXPRT_LOG_HOME: process.env.LLXPRT_LOG_HOME,
  };
  process.env.LLXPRT_CONFIG_HOME = join(evalsStorageRoot, 'config');
  process.env.LLXPRT_DATA_HOME = join(evalsStorageRoot, 'data');
  process.env.LLXPRT_CACHE_HOME = join(evalsStorageRoot, 'cache');
  process.env.LLXPRT_LOG_HOME = join(evalsStorageRoot, 'log');

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

  if (process.env['KEEP_OUTPUT']) {
    console.log(`Keeping output for eval run in: ${runDir}`);
  }
  process.env['VERBOSE'] = process.env['VERBOSE'] ?? 'false';

  console.log(`\nEvals output directory: ${runDir}`);
}

export async function teardown() {
  // Cleanup the eval run directory unless KEEP_OUTPUT is set
  if (process.env['KEEP_OUTPUT'] !== 'true' && runDir) {
    try {
      await rm(runDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Failed to clean up eval run directory:', e);
    }
  }

  // Cleanup the isolated storage root.
  if (evalsStorageRoot) {
    try {
      await rm(evalsStorageRoot, { recursive: true, force: true });
    } catch (e) {
      console.warn('Failed to clean up temporary storage root:', e);
    }
  }

  // Restore original storage env vars so code running after teardown
  // does not reference the now-deleted temp directories.
  for (const [key, value] of Object.entries(savedStorageEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
