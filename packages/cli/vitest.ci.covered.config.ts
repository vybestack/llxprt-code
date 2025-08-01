/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/reducers/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/**/contexts/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/cypress/**'],
    environment: 'jsdom',
    globals: true,
    reporters: ['default', 'junit'],
    silent: true,
    outputFile: {
      junit: 'junit.covered.xml',
    },
    setupFiles: ['./test-setup.ts'],
    poolOptions: {
      threads: { singleThread: true, maxThreads: 2 },
    },
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      include: [
        'src/**/reducers/**/*.{ts,tsx}',
        'src/**/contexts/**/*.{ts,tsx}',
      ],
      reporter: ['text', 'html', 'json-summary'],
    },
  },
});
