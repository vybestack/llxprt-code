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
    reporters: ['default'],
    include: ['**/*.eval.ts'],
  },
});
