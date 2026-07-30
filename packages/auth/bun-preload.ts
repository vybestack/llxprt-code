/**
 * @license
 * Copyright 2025 Vybestack LLC
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

// Isolate Storage roots BEFORE any test module imports Storage.
// This is identical to test-setup-storage-isolation.ts.
import { isolateStorageRoots } from '../storage/src/testing.js';
isolateStorageRoots();
