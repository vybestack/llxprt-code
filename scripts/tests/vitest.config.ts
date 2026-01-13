/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/tests/**/*.test.js'],
    setupFiles: ['scripts/tests/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
  resolve: {
    alias: {
      // @testing-library/react may be hoisted to packages/cli/node_modules
      // instead of root node_modules - ensure it can be resolved
      '@testing-library/react': path.resolve(
        __dirname,
        '../../packages/cli/node_modules/@testing-library/react',
      ),
    },
  },
});
