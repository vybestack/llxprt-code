/**
 * @plan:PLAN-20260610-ISSUE1592.P02
 * @requirement:REQ-PKG-001
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { defineConfig, configDefaults } from 'vitest/config';

const require = createRequire(import.meta.url);

// Resolve ajv/fdir dynamically rather than hardcoding nested node_modules
// paths. npm may hoist or nest these differently depending on the rest of the
// dependency tree (e.g. after security-driven version bumps), so a fixed
// relative path is brittle. createRequire walks the normal Node resolution
// chain and finds them wherever they end up installed.
const ajvCjsEntry = require.resolve('ajv/dist/ajv.js');
const ajv2020Entry = require.resolve('ajv/dist/2020.js');
const fdirEntry = resolve(
  dirname(require.resolve('fdir/package.json')),
  'dist/index.mjs',
);

const isWindows = process.platform === 'win32';
const isMacCi = process.platform === 'darwin' && process.env.CI === 'true';
const shouldUseForkPool = isWindows || isMacCi;

const agentsPackagePrefix = '@vybestack/llxprt-code-agents/';
const authPackagePrefix = '@vybestack/llxprt-code-auth/';
const corePackagePrefix = '@vybestack/llxprt-code-core/';
const settingsPackagePrefix = '@vybestack/llxprt-code-settings/';
const testUtilsPackagePrefix = '@vybestack/llxprt-code-test-utils/';
const agentsEntry = fileURLToPath(new URL('./index.ts', import.meta.url));
const agentsSrcDir = fileURLToPath(new URL('./src/', import.meta.url));
const authEntry = fileURLToPath(new URL('../auth/index.ts', import.meta.url));
const authSrcDir = fileURLToPath(new URL('../auth/src/', import.meta.url));
const coreEntry = fileURLToPath(new URL('../core/index.ts', import.meta.url));
const coreSrcDir = fileURLToPath(new URL('../core/src/', import.meta.url));
const settingsEntry = fileURLToPath(
  new URL('../settings/index.ts', import.meta.url),
);
const settingsSrcDir = fileURLToPath(
  new URL('../settings/src/', import.meta.url),
);
const testUtilsEntry = fileURLToPath(
  new URL('../test-utils/index.ts', import.meta.url),
);
const testUtilsSrcDir = fileURLToPath(
  new URL('../test-utils/src/', import.meta.url),
);

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
    if (source === '@vybestack/llxprt-code-agents') {
      return agentsEntry;
    }
    if (source.startsWith(agentsPackagePrefix)) {
      return resolveTsSource(
        agentsSrcDir,
        source.slice(agentsPackagePrefix.length),
      );
    }
    if (source === '@vybestack/llxprt-code-auth') {
      return authEntry;
    }
    if (source.startsWith(authPackagePrefix)) {
      return resolveTsSource(
        authSrcDir,
        source.slice(authPackagePrefix.length),
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
    if (source === '@vybestack/llxprt-code-settings') {
      return settingsEntry;
    }
    if (source.startsWith(settingsPackagePrefix)) {
      return resolveTsSource(
        settingsSrcDir,
        source.slice(settingsPackagePrefix.length),
      );
    }
    if (source === '@vybestack/llxprt-code-test-utils') {
      return testUtilsEntry;
    }
    if (source.startsWith(testUtilsPackagePrefix)) {
      return resolveTsSource(
        testUtilsSrcDir,
        source.slice(testUtilsPackagePrefix.length),
      );
    }
    if (source === 'ajv') {
      return ajvCjsEntry;
    }
    if (source === 'ajv/dist/2020.js') {
      return ajv2020Entry;
    }
    if (source === 'fdir') {
      return fdirEntry;
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
    passWithNoTests: false,
    // Never discover test files inside Stryker's sandbox/backup tree. The B8
    // mutation gate runs with `inPlace: true`, which keeps a pristine copy of
    // the project under `.stryker-tmp/backup-<id>/`. Without this exclude both
    // normal runs (if a backup is left behind) and Stryker's own dry run would
    // pick up DUPLICATE/stale spec copies from that tree, double-counting tests
    // and corrupting coverage attribution.
    exclude: [...configDefaults.exclude, '**/.stryker-tmp/**'],
    reporters: ['default', 'junit'],
    testTimeout: 30000,
    teardownTimeout: 120000,
    silent: true,
    server: {
      deps: {
        inline: [
          '@vybestack/llxprt-code-agents',
          '@vybestack/llxprt-code-auth',
          '@vybestack/llxprt-code-core',
          '@vybestack/llxprt-code-settings',
          '@vybestack/llxprt-code-test-utils',
          'ajv',
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
