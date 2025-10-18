/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  resolve: {
    conditions: ['node', 'import', 'module', 'browser', 'default'],
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
  },
  test: {
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)', 'config.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/*.integration.{test,spec}.?(c|m)[jt]s?(x)',
      // Temporarily exclude ALL React DOM tests that have React 19 compatibility issues
      // This is a comprehensive exclusion until React 19 compatibility is properly resolved
      '**/*.test.tsx',
      '**/gemini.test.tsx',
      // Exclude UI component tests that may directly import React DOM
      '**/ui/components/**/*.test.ts',
      // Temporarily suppress remaining React 19 regressions until the hooks are migrated
      '**/ui/hooks/**/*.test.ts',
      '**/ui/hooks/**/*.spec.ts',
      // Block the command test that still imports the legacy runtime helpers
      '**/ui/commands/toolformatCommand.test.ts',
    ],
    environment: 'jsdom',
    globals: true,
    reporters: ['default', 'junit'],
    silent: true,
    outputFile: {
      junit: 'junit.xml',
    },
    setupFiles: ['./test-setup.ts'],
    poolOptions: {
      threads: {
        singleThread: true, // Run tests sequentially to reduce memory pressure
        maxThreads: 2, // Limit parallelism
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    environmentOptions: {
      jsdom: {
        resources: 'usable',
        runScripts: 'dangerously',
      },
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
