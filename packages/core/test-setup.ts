/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Unset NO_COLOR environment variable to ensure consistent theme behavior between local and CI test runs
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

import { setSimulate429 } from './src/utils/testUtils.js';
import { beforeEach, afterEach } from 'vitest';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from './src/runtime/providerRuntimeContext.js';
import { SettingsService } from './src/settings/SettingsService.js';

// Disable 429 simulation globally for all tests
setSimulate429(false);

// Set up a runtime context for all tests to prevent MissingProviderRuntimeError
beforeEach(() => {
  const settingsService = new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService,
    runtimeId: 'test-global-runtime',
    metadata: { source: 'test-setup.ts' },
  });
  setActiveProviderRuntimeContext(runtime);
});

afterEach(() => {
  clearActiveProviderRuntimeContext();
});
