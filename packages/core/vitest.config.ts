/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vitest/config';

const isWindows = process.platform === 'win32';
const isMacCi = process.platform === 'darwin' && process.env.CI === 'true';
const shouldUseForkPool = isWindows || isMacCi;

const coverageReporter = isWindows
  ? [
      ['text', { file: 'full-text-summary.txt' }],
      ['json-summary', { outputFile: 'coverage-summary.json' }],
    ]
  : [
      ['text', { file: 'full-text-summary.txt' }],
      'html',
      'json',
      'lcov',
      'cobertura',
      ['json-summary', { outputFile: 'coverage-summary.json' }],
    ];

export default defineConfig({
  test: {
    passWithNoTests: true,
    reporters: ['default', 'junit'],
    testTimeout: 30000,
    teardownTimeout: 120000,
    silent: true,
    setupFiles: ['./test-setup.ts'],
    dangerouslyIgnoreUnhandledErrors: isWindows,
    pool: shouldUseForkPool ? 'forks' : undefined,
    poolOptions: shouldUseForkPool
      ? {
          forks: {
            minForks: 1,
            maxForks: 2,
          },
        }
      : undefined,
    outputFile: {
      junit: 'junit.xml',
    },
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*'],
      reporter: coverageReporter,
    },
  },
});
