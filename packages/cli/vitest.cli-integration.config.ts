/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/integration-tests/**/*.integration.test.ts'],
    environment: 'node',
    globals: true,
    reporters: ['default', 'junit'],
    silent: false,
    outputFile: {
      junit: 'junit-cli-integration.xml',
    },
    coverage: {
      enabled: false,
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
