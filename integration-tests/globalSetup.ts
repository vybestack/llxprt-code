/**
 * @license
 * Copyright 2024 Google LLC
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
  : path.resolve(process.cwd(), 'integration-tests');

const rootDir = join(__dirname, '..');
const integrationTestsDir = join(rootDir, '.integration-tests');
let runDir = ''; // Make runDir accessible in teardown

export async function setup() {
  // Isolate ALL storage roots so spawned CLI subprocesses (which inherit
  // process.env) never write into the real user config/data/cache/log dirs.
  const testStorageRoot = await mkdtemp(
    path.join(os.tmpdir(), 'llxprt-integration-storage-'),
  );
  process.env.LLXPRT_CONFIG_HOME = join(testStorageRoot, 'config');
  process.env.LLXPRT_DATA_HOME = join(testStorageRoot, 'data');
  process.env.LLXPRT_CACHE_HOME = join(testStorageRoot, 'cache');
  process.env.LLXPRT_LOG_HOME = join(testStorageRoot, 'log');

  runDir = join(integrationTestsDir, `${Date.now()}`);
  await mkdir(runDir, { recursive: true });

  // Clean up old test runs, but keep the latest few for debugging
  try {
    const testRuns = await readdir(integrationTestsDir);
    if (testRuns.length > 5) {
      const oldRuns = testRuns.sort().slice(0, testRuns.length - 5);
      await Promise.all(
        oldRuns.map((oldRun) =>
          rm(join(integrationTestsDir, oldRun), {
            recursive: true,
            force: true,
          }),
        ),
      );
    }
  } catch (e) {
    console.error('Error cleaning up old test runs:', e);
  }

  process.env['INTEGRATION_TEST_FILE_DIR'] = runDir;
  // Don't set LLXPRT_CODE_INTEGRATION_TEST anymore - we use --ide-mode disable instead
  process.env['TELEMETRY_LOG_FILE'] = join(runDir, 'telemetry.log');
  // Ensure IDE detection doesn't trigger during tests
  delete process.env['TERM_PROGRAM'];

  if (process.env['KEEP_OUTPUT']) {
    console.log(`Keeping output for test run in: ${runDir}`);
  }
  process.env['VERBOSE'] = process.env['VERBOSE'] ?? 'false';

  console.log(`\nIntegration test output directory: ${runDir}`);
}

export async function teardown() {
  // Cleanup the test run directory unless KEEP_OUTPUT is set
  if (process.env['KEEP_OUTPUT'] !== 'true' && runDir) {
    try {
      await rm(runDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('Failed to clean up test run directory:', e);
    }
  }
}
