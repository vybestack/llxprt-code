/**
 * @plan:PLAN-20260603-ISSUE1584.P06
 * @requirement:REQ-PKG-001
 * @pseudocode lines 13-14
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

const providersPackagePrefix = '@vybestack/llxprt-code-providers/';
const corePackagePrefix = '@vybestack/llxprt-code-core/';
const storagePackagePrefix = '@vybestack/llxprt-code-storage/';
const settingsPackagePrefix = '@vybestack/llxprt-code-settings/';
const providersEntry = fileURLToPath(new URL('./index.ts', import.meta.url));
const providersSrcDir = fileURLToPath(new URL('./src/', import.meta.url));
const coreEntry = fileURLToPath(new URL('../core/index.ts', import.meta.url));
const coreSrcDir = fileURLToPath(new URL('../core/src/', import.meta.url));
const storageEntry = fileURLToPath(
  new URL('../storage/index.ts', import.meta.url),
);
const storageSrcDir = fileURLToPath(
  new URL('../storage/src/', import.meta.url),
);

/**
 * Storage deep-path export mapping mirrors package.json "exports" field.
 * Export subpaths like "./storage/secure-store.js" map to source dirs like "secure-store/".
 */
const storageExportToSource: Record<string, string> = {
  'config/storage': 'config/storage',
  'services/fileSystemService': 'services/fileSystemService',
  'services/fileDiscoveryService': 'services/fileDiscoveryService',
  'storage/secure-store': 'secure-store/secure-store',
  'storage/provider-key-storage': 'secure-store/provider-key-storage',
  'storage/sessionTypes': 'session/sessionTypes',
  'storage/ConversationFileWriter': 'conversation/ConversationFileWriter',
};
const settingsEntry = fileURLToPath(
  new URL('../settings/index.ts', import.meta.url),
);
const settingsSrcDir = fileURLToPath(
  new URL('../settings/src/', import.meta.url),
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
    if (source === '@vybestack/llxprt-code-storage') {
      return storageEntry;
    }
    if (source.startsWith(storagePackagePrefix)) {
      const subPath = source
        .slice(storagePackagePrefix.length)
        .replace(/\.js$/, '');
      const sourcePath = storageExportToSource[subPath];
      if (sourcePath) {
        const tsPath = storageSrcDir + sourcePath + '.ts';
        if (existsSync(tsPath)) {
          return tsPath;
        }
      }
      return resolveTsSource(
        storageSrcDir,
        source.slice(storagePackagePrefix.length),
      );
    }
    // @plan PLAN-20260608-ISSUE1588.P03b — settings source alias
    if (source === '@vybestack/llxprt-code-settings') {
      return settingsEntry;
    }
    if (source.startsWith(settingsPackagePrefix)) {
      return resolveTsSource(
        settingsSrcDir,
        source.slice(settingsPackagePrefix.length),
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
    setupFiles: ['./test-setup.ts'],
    server: {
      deps: {
        inline: [
          '@vybestack/llxprt-code-core',
          '@vybestack/llxprt-code-storage',
          '@vybestack/llxprt-code-providers',
          '@vybestack/llxprt-code-settings',
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
