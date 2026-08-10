/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3181 — the published CLI bundle must be able to resolve
 * tree-sitter-pwsh/tree-sitter-powershell.wasm from its own direct dependency,
 * without relying on root-level hoisting.
 *
 * The bundled CLI lives in `packages/cli/bundle/`. At runtime, `shell-parser.ts`
 * resolves the WASM via `createRequire(import.meta.url)` +
 * `require.resolve('tree-sitter-pwsh/tree-sitter-powershell.wasm')`. In a
 * strict (non-hoisted) npm layout, this resolution succeeds only if
 * tree-sitter-pwsh is a direct dependency of the package that owns the bundle
 * (packages/cli), because Node's module resolution walks up from the bundle's
 * directory to the nearest `node_modules`.
 *
 * These tests construct a real isolated layout (tree-sitter-pwsh placed only in
 * the package's own `node_modules`, never hoisted to a parent) and prove
 * resolution works — and fails when the local copy is absent.
 */

import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, '..', '..', '..');
const cliPackageJsonPath = join(repoRoot, 'packages', 'cli', 'package.json');

const localRequire = createRequire(import.meta.url);

/**
 * Path to the real tree-sitter-powershell.wasm installed in the workspace.
 */
const realWasmPath = localRequire.resolve(
  'tree-sitter-pwsh/tree-sitter-powershell.wasm',
);

/**
 * Read the actual installed tree-sitter-pwsh version so the synthetic
 * package.json mirrors the real dependency without hardcoding a version
 * that could drift (#3181 OCR).
 */
const realPwshPackageJsonPath = localRequire.resolve(
  'tree-sitter-pwsh/package.json',
);
const realPwshPackage = JSON.parse(
  readFileSync(realPwshPackageJsonPath, 'utf8'),
) as { name: string; version: string };

describe('issue #3181: CLI resolves tree-sitter-pwsh WASM from its direct dependency', () => {
  it('packages/cli declares tree-sitter-pwsh as a direct runtime dependency', () => {
    const pkg = JSON.parse(readFileSync(cliPackageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toBeDefined();
    expect(pkg.dependencies!['tree-sitter-pwsh']).toBeDefined();
  });

  it('resolves tree-sitter-powershell.wasm in a strict (non-hoisted) layout', () => {
    // Build an isolated layout that mimics a strict npm install:
    //   <tempRoot>/
    //     cli/
    //       node_modules/
    //         tree-sitter-pwsh/
    //           package.json
    //           tree-sitter-powershell.wasm   ← real WASM
    //       bundle/
    //         resolve-test.mjs                ← simulated bundle location
    //
    // tree-sitter-pwsh exists ONLY in cli/node_modules — no parent hoisting.
    const tempRoot = mkdtempSync(join(tmpdir(), 'issue3181-pwsh-strict-'));
    try {
      const cliDir = join(tempRoot, 'cli');
      const pwshDir = join(cliDir, 'node_modules', 'tree-sitter-pwsh');
      const bundleDir = join(cliDir, 'bundle');
      mkdirSync(pwshDir, { recursive: true });
      mkdirSync(bundleDir, { recursive: true });

      // Minimal package.json so Node recognizes the directory as a module.
      writeFileSync(
        join(pwshDir, 'package.json'),
        JSON.stringify({
          name: realPwshPackage.name,
          version: realPwshPackage.version,
        }),
      );

      // Copy the real WASM so resolution points at a real file.
      copyFileSync(realWasmPath, join(pwshDir, 'tree-sitter-powershell.wasm'));

      // Node ESM script that uses the same resolution mechanism as
      // shell-parser.ts: createRequire(import.meta.url) + require.resolve.
      const scriptPath = join(bundleDir, 'resolve-test.mjs');
      writeFileSync(
        scriptPath,
        [
          "import { createRequire } from 'node:module';",
          "import { existsSync } from 'node:fs';",
          'const require = createRequire(import.meta.url);',
          'try {',
          "  const p = require.resolve('tree-sitter-pwsh/tree-sitter-powershell.wasm');",
          '  process.stdout.write(JSON.stringify({ resolved: true, exists: existsSync(p) }));',
          '} catch (e) {',
          '  process.stdout.write(JSON.stringify({ resolved: false, error: String(e) }));',
          '}',
        ].join('\n'),
      );

      const stdout = execFileSync('node', [scriptPath], {
        encoding: 'utf8',
        timeout: 10_000,
      });

      const result = JSON.parse(stdout) as {
        resolved: boolean;
        exists?: boolean;
        error?: string;
      };
      expect(result.resolved).toBe(true);
      expect(result.exists).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('resolution fails when tree-sitter-pwsh is absent from local node_modules (test has teeth)', () => {
    // Same strict layout but WITHOUT tree-sitter-pwsh in any node_modules.
    // Resolution MUST fail, proving the positive test is not vacuously true.
    const tempRoot = mkdtempSync(join(tmpdir(), 'issue3181-pwsh-absent-'));
    try {
      const cliDir = join(tempRoot, 'cli');
      const bundleDir = join(cliDir, 'bundle');
      mkdirSync(bundleDir, { recursive: true });

      const scriptPath = join(bundleDir, 'resolve-test.mjs');
      writeFileSync(
        scriptPath,
        [
          "import { createRequire } from 'node:module';",
          'const require = createRequire(import.meta.url);',
          'try {',
          "  require.resolve('tree-sitter-pwsh/tree-sitter-powershell.wasm');",
          '  process.stdout.write(JSON.stringify({ resolved: true }));',
          '} catch {',
          '  process.stdout.write(JSON.stringify({ resolved: false }));',
          '}',
        ].join('\n'),
      );

      const stdout = execFileSync('node', [scriptPath], {
        encoding: 'utf8',
        timeout: 10_000,
      });

      const result = JSON.parse(stdout) as { resolved: boolean };
      expect(result.resolved).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
