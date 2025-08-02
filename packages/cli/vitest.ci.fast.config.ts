/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    environment: 'jsdom',
    globals: true,
    reporters: ['default', 'junit'],
    silent: true,
    outputFile: { junit: 'junit.fast.xml' },
    setupFiles: ['./test-setup.ts'],
    poolOptions: { threads: { singleThread: true, maxThreads: 2 } },
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: { enabled: false },
  },
});
