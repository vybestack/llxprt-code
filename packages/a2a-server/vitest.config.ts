/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const corePackagePrefix = '@vybestack/llxprt-code-core/';
const providersPackagePrefix = '@vybestack/llxprt-code-providers/';
const coreEntry = resolve(__dirname, '../core/index.ts');
const coreSrcDir = resolve(__dirname, '../core/src/') + '/';
const providersEntry = resolve(__dirname, '../providers/index.ts');
const providersSrcDir = resolve(__dirname, '../providers/src/') + '/';
const ajv2020Entry = resolve(
  __dirname,
  '../../node_modules/ajv-formats/node_modules/ajv/dist/2020.js',
);
const ajvCjsEntry = resolve(
  __dirname,
  '../../node_modules/ajv-formats/node_modules/ajv/dist/ajv.js',
);
const fdirEntry = resolve(
  __dirname,
  '../../node_modules/vite/node_modules/fdir/dist/index.mjs',
);

function resolveTsSource(baseDir: string, specifier: string): string {
  const direct = baseDir + specifier;
  if (direct.endsWith('.js')) {
    const withoutExt = direct.slice(0, -3);
    const tsPath = withoutExt + '.ts';
    if (existsSync(tsPath)) {
      return tsPath;
    }
    // Directory-index subpaths (e.g. `runtime.js` -> `runtime/index.ts`) mirror
    // how the package export maps resolve `./runtime.js` to `runtime/index.js`.
    const indexPath = withoutExt + '/index.ts';
    if (existsSync(indexPath)) {
      return indexPath;
    }
  }
  return direct;
}

const workspaceDependencyAliasPlugin = {
  name: 'llxprt-a2a-workspace-source-aliases',
  enforce: 'pre' as const,
  /**
   * @plan:PLAN-20260603-ISSUE1584.P16
   * @requirement:REQ-VERIFY-001
   * @pseudocode verification.md lines 19-22
   */
  resolveId(source: string) {
    if (source === '@vybestack/llxprt-code-core') {
      return coreEntry;
    }
    if (source.startsWith(corePackagePrefix)) {
      return resolveTsSource(
        coreSrcDir,
        source.slice(corePackagePrefix.length),
      );
    }
    if (source === '@vybestack/llxprt-code-providers') {
      return providersEntry;
    }
    if (source.startsWith(providersPackagePrefix)) {
      return resolveTsSource(
        providersSrcDir,
        source.slice(providersPackagePrefix.length),
      );
    }
    if (source === 'ajv/dist/2020.js') {
      return ajv2020Entry;
    }
    if (source === 'ajv') {
      return ajvCjsEntry;
    }
    if (source === 'fdir') {
      return fdirEntry;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [workspaceDependencyAliasPlugin],
  resolve: {
    alias: {
      /**
       * @plan:PLAN-20260603-ISSUE1584.P16
       * @requirement:REQ-VERIFY-001
       * @pseudocode verification.md lines 19-22
       */
      'ajv/dist/2020.js': ajv2020Entry,
      ajv: ajvCjsEntry,
      fdir: fdirEntry,
    },
  },
  test: {
    reporters: [['default'], ['junit', { outputFile: 'junit.xml' }]],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
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
