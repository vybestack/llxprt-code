/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const providersPackagePrefix = '@vybestack/llxprt-code-providers/';
const corePackagePrefix = '@vybestack/llxprt-code-core/';
const toolsPackagePrefix = '@vybestack/llxprt-code-tools/';
const settingsPackagePrefix = '@vybestack/llxprt-code-settings/';
const ideIntegrationPackagePrefix = '@vybestack/llxprt-code-ide-integration/';
const providersEntry = fileURLToPath(
  new URL('../providers/index.ts', import.meta.url),
);
const providersSrcDir = fileURLToPath(
  new URL('../providers/src/', import.meta.url),
);
const coreEntry = fileURLToPath(new URL('./index.ts', import.meta.url));
const toolsEntry = fileURLToPath(new URL('../tools/index.ts', import.meta.url));
const toolsSrcDir = fileURLToPath(new URL('../tools/src/', import.meta.url));

const coreSrcDir = fileURLToPath(new URL('./src/', import.meta.url));
const settingsEntry = fileURLToPath(
  new URL('../settings/index.ts', import.meta.url),
);
const settingsSrcDir = fileURLToPath(
  new URL('../settings/src/', import.meta.url),
);
const ideIntegrationEntry = fileURLToPath(
  new URL('../ide-integration/index.ts', import.meta.url),
);
const ideIntegrationSrcDir = fileURLToPath(
  new URL('../ide-integration/src/', import.meta.url),
);
const ajvCjsEntry = fileURLToPath(
  new URL(
    '../../node_modules/ajv-formats/node_modules/ajv/dist/ajv.js',
    import.meta.url,
  ),
);
const ajv2020Entry = fileURLToPath(
  new URL(
    '../../node_modules/ajv-formats/node_modules/ajv/dist/2020.js',
    import.meta.url,
  ),
);
const fdirEntry = fileURLToPath(
  new URL(
    '../../node_modules/vite/node_modules/fdir/dist/index.mjs',
    import.meta.url,
  ),
);

function resolveTsSource(baseDir: string, specifier: string): string | null {
  const direct = baseDir + specifier;
  if (direct.endsWith('.js')) {
    const tsPath = direct.slice(0, -3) + '.ts';
    if (existsSync(tsPath)) {
      return tsPath;
    }
  }
  if (existsSync(direct)) {
    return direct;
  }
  return null;
}

const workspaceDependencyAliasPlugin = {
  name: 'llxprt-core-workspace-dependency-aliases',
  enforce: 'pre' as const,
  /**
   * @plan:PLAN-20260603-ISSUE1584.P16
   * @requirement:REQ-VERIFY-001
   * @pseudocode verification.md lines 19-22
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
    if (source === '@vybestack/llxprt-code-tools') {
      return toolsEntry;
    }
    if (source.startsWith(toolsPackagePrefix)) {
      return resolveTsSource(
        toolsSrcDir,
        source.slice(toolsPackagePrefix.length),
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
    if (source === '@vybestack/llxprt-code-ide-integration') {
      return ideIntegrationEntry;
    }
    if (source.startsWith(ideIntegrationPackagePrefix)) {
      return resolveTsSource(
        ideIntegrationSrcDir,
        source.slice(ideIntegrationPackagePrefix.length),
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

const isWindows = process.platform === 'win32';
const isMacCi = process.platform === 'darwin' && process.env.CI === 'true';
const shouldUseForkPool = isWindows || isMacCi;

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
  plugins: [workspaceDependencyAliasPlugin],
  test: {
    passWithNoTests: true,
    reporters: ['default', 'junit'],
    testTimeout: 30000,
    teardownTimeout: 120000,
    silent: true,
    setupFiles: ['./test-setup.ts'],
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
    server: {
      deps: {
        inline: [
          '@vybestack/llxprt-code-providers',
          '@vybestack/llxprt-code-settings',
          '@vybestack/llxprt-code-ide-integration',
          'ajv',
          'fdir',
        ],
      },
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
