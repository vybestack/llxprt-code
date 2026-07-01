/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-PKG-001
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const isWindows = process.platform === 'win32';
const isMacCi = process.platform === 'darwin' && process.env.CI === 'true';
const shouldUseForkPool = isWindows || isMacCi;

const toolsPackagePrefix = '@vybestack/llxprt-code-tools/';
const toolsEntry = fileURLToPath(new URL('./index.ts', import.meta.url));
const toolsSrcDir = fileURLToPath(new URL('./src/', import.meta.url));
const storageEntry = fileURLToPath(
  new URL('../storage/src/index.ts', import.meta.url),
);
const storageSrcDir = fileURLToPath(
  new URL('../storage/src/', import.meta.url),
);

const storagePackagePrefix = '@vybestack/llxprt-code-storage/';

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
  resolveId(source: string) {
    if (source === '@vybestack/llxprt-code-tools') {
      return toolsEntry;
    }
    if (source.startsWith(toolsPackagePrefix)) {
      return resolveTsSource(
        toolsSrcDir,
        source.slice(toolsPackagePrefix.length),
      );
    }
    if (source === '@vybestack/llxprt-code-storage') {
      return storageEntry;
    }
    if (source.startsWith(storagePackagePrefix)) {
      return resolveTsSource(
        storageSrcDir,
        source.slice(storagePackagePrefix.length),
      );
    }
    return null;
  },
};

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
  plugins: [workspaceAliasPlugin],
  test: {
    passWithNoTests: true,
    reporters: ['default', 'junit'],
    testTimeout: 30000,
    teardownTimeout: 120000,
    silent: true,
    server: {
      deps: {
        inline: [
          '@vybestack/llxprt-code-tools',
          '@vybestack/llxprt-code-storage',
        ],
      },
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
