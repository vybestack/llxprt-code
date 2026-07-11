/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'bun:test': 'vitest',
    },
  },
  test: {
    globals: true,
    passWithNoTests: true,
    reporters: ['default', 'junit'],
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
        ['json-summary', { outputFile: 'coverage-summary.json' }],
      ],
    },
  },
});
