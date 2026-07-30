/**
 * @license
 * Copyright 2026 Vybestack LLC
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

import { beforeAll, beforeEach, afterEach, mock } from 'bun:test';
import { createRequire } from 'node:module';

// Safety: mark environment as CI so that browser-launching code paths
// (shouldLaunchBrowser) short-circuit. Under Bun's single-process test
// runner, mock.module state from one test file can leak into the next;
// if a child_process mock fails to register, a test calling
// openBrowserSecurely would spawn a real `open` command. Setting CI=true
// prevents any test from inadvertently launching a real browser.
process.env.CI = 'true';

// Pre-register a child_process mock that throws instead of executing real
// commands. Individual test files override this with their own vi.mock()
// or mock.module() for specific assertions. This safety net ensures that
// no test can ever accidentally spawn a real process (e.g., `open` on
// macOS opening thousands of browser windows).
const localRequire = createRequire(import.meta.url);
const realChildProcess = localRequire('node:child_process');
mock.module('node:child_process', () => ({
  ...realChildProcess,
  execFile: (): never => {
    throw new Error(
      'execFile called without a test-local mock. Add vi.mock("child_process") or vi.mock("node:child_process") to the test file.',
    );
  },
  exec: (): never => {
    throw new Error(
      'exec called without a test-local mock. Add vi.mock("child_process") to the test file.',
    );
  },
  spawn: (): never => {
    throw new Error(
      'spawn called without a test-local mock. Add vi.mock("child_process") to the test file.',
    );
  },
}));

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
