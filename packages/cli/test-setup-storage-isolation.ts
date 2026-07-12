/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Isolates ALL storage roots to a per-run temp directory so tests can never
 * write into the real user config/data dirs (profiles, settings, secure
 * store). Integration tests previously leaked artifacts such as
 * test-profile.json into ~/Library/Preferences/llxprt-code/profiles because
 * ProfileManager defaults to Storage.getGlobalConfigDir().
 *
 * Storage.getGlobal*Dir() reads these env vars at call time, and CLI
 * subprocesses spawned by integration tests inherit process.env, so setting
 * them here covers both in-process and subprocess writes.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// Guard on a dedicated marker (NOT on LLXPRT_CONFIG_HOME): a developer or CI
// shell may legitimately export LLXPRT_CONFIG_HOME for CLI usage, and reusing
// it as the guard would silently skip isolation and let tests write into that
// real directory. The marker only dedupes isolation within this process tree.
if (!process.env.LLXPRT_TEST_STORAGE_ISOLATED) {
  const testStorageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'llxprt-cli-test-storage-'),
  );
  process.env.LLXPRT_CONFIG_HOME = path.join(testStorageRoot, 'config');
  process.env.LLXPRT_DATA_HOME = path.join(testStorageRoot, 'data');
  process.env.LLXPRT_CACHE_HOME = path.join(testStorageRoot, 'cache');
  process.env.LLXPRT_TEST_STORAGE_ISOLATED = '1';
}
