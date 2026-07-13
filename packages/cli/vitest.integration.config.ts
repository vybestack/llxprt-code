/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const providersPackagePrefix = '@vybestack/llxprt-code-providers/';
const corePackagePrefix = '@vybestack/llxprt-code-core/';
const providersEntry = fileURLToPath(
  new URL('../providers/index.ts', import.meta.url),
);
const providersSrcDir = fileURLToPath(
  new URL('../providers/src/', import.meta.url),
);
const coreEntry = fileURLToPath(new URL('../core/index.ts', import.meta.url));
const coreSrcDir = fileURLToPath(new URL('../core/src/', import.meta.url));

function resolveTsSource(baseDir: string, specifier: string): string {
  const direct = baseDir + specifier;
  if (direct.endsWith('.js')) {
    const tsPath = direct.slice(0, -3) + '.ts';
    if (existsSync(tsPath)) {
      return tsPath;
    }
  }
  return direct;
}

const workspaceAliasPlugin = {
  name: 'llxprt-workspace-source-aliases',
  enforce: 'pre' as const,
  /**
   * @plan:PLAN-20260603-ISSUE1584.P13
   * @requirement:REQ-API-001
   * @pseudocode consumer-migration.md lines 10-18
   */
  resolveId(source: string) {
    if (source === '@vybestack/llxprt-code-providers') {
      return providersEntry;
    }
    if (source.startsWith(providersPackagePrefix)) {
      return resolveTsSource(
        providersSrcDir,
        source.slice(providersPackagePrefix.length),
      );
    }
    if (source === '@vybestack/llxprt-code-core') {
      return coreEntry;
    }
    if (source.startsWith(corePackagePrefix)) {
      return resolveTsSource(
        coreSrcDir,
        source.slice(corePackagePrefix.length),
      );
    }
    if (source === 'ajv') {
      return fileURLToPath(
        new URL(
          '../../node_modules/ajv-formats/node_modules/ajv/dist/ajv.js',
          import.meta.url,
        ),
      );
    }
    if (source === 'ajv/dist/2020.js') {
      return fileURLToPath(
        new URL(
          '../../node_modules/ajv-formats/node_modules/ajv/dist/2020.js',
          import.meta.url,
        ),
      );
    }
    if (source === 'fdir') {
      return fileURLToPath(
        new URL(
          '../../node_modules/vite/node_modules/fdir/dist/index.mjs',
          import.meta.url,
        ),
      );
    }
    return null;
  },
};

export default defineConfig({
  plugins: [workspaceAliasPlugin],
  test: {
    include: ['**/*.integration.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/ui/**/*.integration.test.ts', // Exclude UI tests that need jsdom
      '**/config/config.integration.test.ts', // Exclude config tests that need jsdom
    ],
    environment: 'node', // Use node environment for integration tests
    server: {
      deps: {
        inline: [
          '@vybestack/llxprt-code-core',
          '@vybestack/llxprt-code-providers',
          'ajv',
        ],
      },
    },
    globals: true,
    reporters: ['default'],
    setupFiles: ['./test-setup-storage-isolation.ts'],
    testTimeout: 30000, // Longer timeout for integration tests
    poolOptions: {
      threads: {
        singleThread: true, // Run tests sequentially to reduce memory pressure
        maxThreads: 2, // Limit parallelism
      },
    },
    hookTimeout: 30000,
  },
});
