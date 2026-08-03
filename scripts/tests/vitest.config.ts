/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/tests/**/*.test.{js,ts}'],
    // `*.bun.test.ts` files are Bun-native tests run via
    // scripts/bun-test-manifest.ts (issue #2475). Vitest must skip them so the
    // scripts shard doesn't fail on the `bun:test` import specifier.
    exclude: [...configDefaults.exclude, '**/*.bun.test.{js,ts}'],
    setupFiles: ['scripts/tests/test-setup.ts'],
    // Bound process-heavy file concurrency so worker task updates remain
    // responsive while subprocess and filesystem harnesses run in parallel.
    maxWorkers: 4,
    // Many script-harness tests spawn subprocesses (bash scripts, python
    // fake-gh, jq pipelines) and do filesystem work under temp directories.
    // Vitest's 5s default is far too tight for that workload — especially
    // on slower CI runners where process spawning and I/O are 2-3x slower.
    // 30s accommodates subprocess-heavy tests while still failing fast on a
    // genuine hang. Tests that are genuinely much slower (e.g. the pagination
    // test that processes 35 issues across multiple gh-api pages) override
    // this with a per-test { timeout } option.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
    },
  },
  resolve: {
    alias: {
      // @testing-library/react is hoisted to root node_modules
      '@testing-library/react': path.resolve(
        __dirname,
        '../../node_modules/@testing-library/react',
      ),
    },
  },
});
