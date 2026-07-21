/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 300000, // 5 minutes
    globalSetup: './globalSetup.ts',
    reporters: ['default', 'json'],
    // Vitest resolves outputFile relative to the configured root (--root).
    // The eval scripts run with `--root ./evals`, so this path must be
    // relative to that root (not to the repository root) to avoid writing
    // report.json to evals/evals/logs/report.json, which escapes the uploaded
    // evals/logs artifact directory.
    outputFile: {
      json: 'logs/report.json',
    },
    include: ['**/*.eval.ts'],
  },
});
