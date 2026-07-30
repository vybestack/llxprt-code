/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun test preload for the core workspace.
 *
 * Replicates the behavior of the vitest setupFiles
 * (test-setup-storage-isolation.ts + test-setup.ts) so that Bun test files
 * get the same Storage isolation and provider-runtime bootstrapping without
 * changes to the individual test modules.
 */

import { beforeAll, beforeEach, afterEach } from 'bun:test';

// 1. Isolate Storage roots BEFORE any test module imports Storage.
//    This is identical to test-setup-storage-isolation.ts.
import { isolateStorageRoots } from '../storage/src/testing.js';
isolateStorageRoots();

// 2. Replicate test-setup.ts behavior.
//    Unset NO_COLOR for consistent theme behavior.
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

import { setSimulate429 } from './src/utils/testUtils.js';
import { clearActiveProviderRuntimeContext } from './src/runtime/providerRuntimeContext.js';
import { initializeTestProviderRuntime } from './src/test-utils/runtime.js';

// Disable 429 simulation globally for all tests.
setSimulate429(false);

function bootstrapRuntime(scope: string): void {
  initializeTestProviderRuntime({
    runtimeId: `test-global-runtime.${scope}`,
    metadata: { source: `bun-preload.ts:${scope}` },
  });
}

beforeAll(() => {
  bootstrapRuntime('beforeAll');
});

// Set up a runtime context for all tests to prevent
// MissingProviderRuntimeError.
beforeEach(() => {
  bootstrapRuntime('beforeEach');
});

afterEach(() => {
  clearActiveProviderRuntimeContext();
});
