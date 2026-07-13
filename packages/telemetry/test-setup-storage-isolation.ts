/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

if (!process.env.LLXPRT_TEST_STORAGE_ISOLATED) {
  const testStorageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'llxprt-test-storage-'),
  );
  process.env.LLXPRT_CONFIG_HOME = path.join(testStorageRoot, 'config');
  process.env.LLXPRT_DATA_HOME = path.join(testStorageRoot, 'data');
  process.env.LLXPRT_CACHE_HOME = path.join(testStorageRoot, 'cache');
  process.env.LLXPRT_LOG_HOME = path.join(testStorageRoot, 'log');
  for (const sub of ['config', 'data', 'cache', 'log']) {
    fs.mkdirSync(path.join(testStorageRoot, sub), { recursive: true });
  }
  process.env.LLXPRT_TEST_STORAGE_ISOLATED = '1';
}
