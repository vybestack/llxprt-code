/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vitest/config';

const isWindows = process.platform === 'win32';
const isMacCi = process.platform === 'darwin' && process.env.CI === 'true';
const shouldUseForkPool = isWindows || isMacCi;

export default defineConfig({
  test: {
    passWithNoTests: true,
    reporters: ['default', 'junit'],
    testTimeout: 30000,
    teardownTimeout: 120000,
    silent: true,
    outputFile: {
      junit: 'junit.xml',
    },
    pool: shouldUseForkPool ? 'forks' : undefined,
    poolOptions: shouldUseForkPool
      ? {
          forks: {
            minForks: 1,
            maxForks: 2,
          },
        }
      : undefined,
    coverage: {
      enabled: true,
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['src/**/*'],
      reporter: [
        ['text', { file: 'full-text-summary.txt' }],
        'json',
        'lcov',
        'cobertura',
        ['json-summary', { outputFile: 'coverage-summary.json' }],
      ],
    },
  },
});
