/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vitest/config';

const isWindows = process.platform === 'win32';

export default defineConfig({
  test: {
    passWithNoTests: true,
    reporters: ['default', 'junit'],
    timeout: 30000,
    teardownTimeout: 120000,
    silent: true,
    setupFiles: ['./test-setup.ts'],
    pool: isWindows ? 'forks' : 'threads',
    poolOptions: isWindows
      ? {
          forks: {
            minForks: 1,
            maxForks: 3,
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
      reporter: [
        ['text', { file: 'full-text-summary.txt' }],
        'html',
        'json',
        'lcov',
        'cobertura',
        ['json-summary', { outputFile: 'coverage-summary.json' }],
      ],
    },
  },
});
