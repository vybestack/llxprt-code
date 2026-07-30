/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test preload for the auth workspace.
 *
 * Replicates the behavior of the vitest setupFiles
 * (test-setup-storage-isolation.ts + test-setup.ts) so that Bun test files
 * get the same Storage isolation without changes to the individual test
 * modules.
 */

// Safety: mark environment as CI to prevent any test from launching a
// real browser via openBrowserSecurely (mock.module can leak across files
// in Bun's single-process test runner).
process.env.CI = 'true';

// Isolate Storage roots BEFORE any test module imports Storage.
// This is identical to test-setup-storage-isolation.ts.
import { isolateStorageRoots } from '../storage/src/testing.js';
isolateStorageRoots();
