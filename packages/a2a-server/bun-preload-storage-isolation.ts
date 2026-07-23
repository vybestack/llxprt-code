/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test preload: isolates Storage roots BEFORE any test module imports
 * Storage.
 *
 * `bun test` does not run Vitest's `setupFiles`. Without this preload, the
 * a2a-server Bun test suite resolves Storage paths against the real user
 * config/data/cache/log directories and may write deterministic artifacts
 * into them. This preload runs at module-evaluation time (before test modules
 * are imported), invoking the same `isolateStorageRoots()` helper that the
 * Vitest setup uses, so both runners share identical isolation semantics.
 *
 * Cleanup: the temp root is intentionally left in place (same contract as the
 * Vitest setup). Bun spawns each test file in its own process, and the
 * isolation marker (`LLXPRT_TEST_STORAGE_ISOLATED`) makes repeated calls in
 * the same process idempotent.
 *
 * Wired via the package.json `test`/`test:ci` scripts' `--preload` flag so it
 * applies to every `bun test` invocation in this workspace.
 */

import { isolateStorageRoots } from '../storage/src/testing.js';

isolateStorageRoots();
