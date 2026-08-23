/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Redirects every storage root to a per-process temp directory before any test
 * module can import Storage.
 *
 * This is the repo-root counterpart to the per-workspace
 * `test-setup-storage-isolation.ts` preloads. It covers `bun test` invoked from
 * the repository root, which is how the `scripts/tests` suite runs.
 */

import { isolateStorageRoots } from '../../packages/storage/src/testing.js';

isolateStorageRoots();
