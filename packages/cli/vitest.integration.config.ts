/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.integration.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/ui/**/*.integration.test.ts', // Exclude UI tests that need jsdom
      '**/config/config.integration.test.ts', // Exclude config tests that need jsdom
    ],
    environment: 'node', // Use node environment for integration tests
    globals: true,
    reporters: ['default'],
    testTimeout: 30000, // Longer timeout for integration tests
    poolOptions: {
      threads: {
        singleThread: true, // Run tests sequentially to reduce memory pressure
        maxThreads: 2, // Limit parallelism
      },
    },
    hookTimeout: 30000,
  },
});
