/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);
const configDir = dirname(fileURLToPath(import.meta.url));

// Resolve the IDE integration workspace dependency to its TypeScript source
// public entry so tests exercise changed source directly rather than a stale
// dist build. This keeps regression tests honest without a prebuild step.
const ideIntegrationSourceEntry = resolve(
  configDir,
  '../ide-integration/index.ts',
);

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

const workspaceDependencyAliasPlugin = {
  name: 'llxprt-vscode-workspace-dependency-aliases',
  enforce: 'pre' as const,
  /**
   * @plan:PLAN-20260603-ISSUE1584.P16
   * @requirement:REQ-VERIFY-001
   * @pseudocode verification.md lines 19-22
   */
  resolveId(source: string) {
    if (source === '@vybestack/llxprt-code-ide-integration') {
      return ideIntegrationSourceEntry;
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

export default defineConfig({
  plugins: [workspaceDependencyAliasPlugin],
  test: {
    setupFiles: ['./test-setup-storage-isolation.ts'],
    server: {
      deps: {
        inline: ['@vybestack/llxprt-code-ide-integration', 'ajv', 'fdir'],
      },
    },
  },
});
