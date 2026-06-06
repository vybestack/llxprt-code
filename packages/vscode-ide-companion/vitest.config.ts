/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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

const workspaceDependencyAliasPlugin = {
  name: 'llxprt-vscode-workspace-dependency-aliases',
  enforce: 'pre' as const,
  /**
   * @plan:PLAN-20260603-ISSUE1584.P16
   * @requirement:REQ-VERIFY-001
   * @pseudocode verification.md lines 19-22
   */
  resolveId(source: string) {
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

export default defineConfig({
  plugins: [workspaceDependencyAliasPlugin],
  test: {
    server: {
      deps: {
        inline: ['@vybestack/llxprt-code-core', 'ajv', 'fdir'],
      },
    },
  },
});
