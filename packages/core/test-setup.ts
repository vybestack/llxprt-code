/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Unset NO_COLOR environment variable to ensure consistent theme behavior between local and CI test runs
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

import { setSimulate429 } from './src/utils/testUtils.js';
import { beforeAll, beforeEach, afterEach } from 'vitest';
import { clearActiveProviderRuntimeContext } from './src/runtime/providerRuntimeContext.js';
import { initializeTestProviderRuntime } from './src/test-utils/runtime.js';

// Disable 429 simulation globally for all tests
setSimulate429(false);

function bootstrapRuntime(scope: string): void {
  initializeTestProviderRuntime({
    runtimeId: `test-global-runtime.${scope}`,
    metadata: { source: `test-setup.ts:${scope}` },
  });
}

beforeAll(() => {
  bootstrapRuntime('beforeAll');
});

// Set up a runtime context for all tests to prevent MissingProviderRuntimeError
beforeEach(() => {
  bootstrapRuntime('beforeEach');
});

afterEach(() => {
  clearActiveProviderRuntimeContext();
});
