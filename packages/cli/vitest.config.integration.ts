/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/providers/integration/**/*.test.ts'],
    environment: 'node',
    globals: true,
    reporters: ['default', 'junit'],
    silent: true,
    outputFile: {
      junit: 'junit-integration.xml',
    },
    // Coverage is usually not needed for integration tests, but can be enabled if desired
    coverage: {
      enabled: false,
    },
  },
});
