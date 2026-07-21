/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(thisFile, '..', '..', '..');
const nodeRequire = createRequire(import.meta.url);
const cliModulePath = join(
  repoRoot,
  'packages',
  'cli',
  'scripts',
  'install-native-launchers.cjs',
);

/**
 * Known shape of the installer module's test-only internals.
 * createRequire returns an untyped CommonJS require, so the return is cast to
 * this known shape rather than relying on the implicit `any`.
 */
interface CliInstallerInternals {
  extractPs1ShimTargets: (content: string) => string[];
  extractCmdShimTargets: (content: string) => string[];
}
function loadCliInstaller(): CliInstallerInternals {
  delete nodeRequire.cache[cliModulePath];
  const mod = nodeRequire(cliModulePath) as CliInstallerInternals & {
    _testing?: Partial<CliInstallerInternals>;
  };
  // Implementation-detail helpers are exposed under a private `_testing`
  // namespace; merge them onto the top-level return for legacy `mod.X` access.
  return { ...mod, ...(mod._testing || {}) } as CliInstallerInternals;
}

describe('shim target extraction accepts both path separators', () => {
  // Parameterized helper to reduce boilerplate: load module, call extractor,
  // assert the expected target is present.
  function assertExtract(
    extractor: 'extractPs1ShimTargets' | 'extractCmdShimTargets',
    content: string,
    expectedTarget: string,
  ): void {
    const mod = loadCliInstaller();
    const targets = mod[extractor](content);
    expect(targets).toContain(expectedTarget);
  }

  it('extractPs1ShimTargets accepts forward-slash $basedir paths', () => {
    const mod = loadCliInstaller();
    const content = [
      '$basedir = Split-Path $MyInvocation.MyCommand.Definition -Parent',
      '$exe = "$basedir//bin/sh$exe"',
      '$target = "$basedir/../lib/node_modules/@vybestack/llxprt-code/bin/llxprt"',
    ].join('\n');
    const targets = mod.extractPs1ShimTargets(content);
    // Both the interpreter and package target should be extracted.
    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect(targets).toContain('/bin/sh$exe');
    expect(targets).toContain(
      '../lib/node_modules/@vybestack/llxprt-code/bin/llxprt',
    );
  });

  it('extractPs1ShimTargets accepts backslash $basedir paths (Windows)', () => {
    assertExtract(
      'extractPs1ShimTargets',
      [
        '$target = "$basedir\\..\\lib\\node_modules\\@vybestack\\llxprt-code\\bin\\llxprt"',
      ].join('\n'),
      '..\\lib\\node_modules\\@vybestack\\llxprt-code\\bin\\llxprt',
    );
  });

  it('extractCmdShimTargets accepts backslash %dp0% paths', () => {
    assertExtract(
      'extractCmdShimTargets',
      [
        '@echo off',
        '"/bin/sh.exe" "%dp0%\\..\\lib\\node_modules\\@vybestack\\llxprt-code\\bin\\llxprt" %*',
      ].join('\n'),
      '..\\lib\\node_modules\\@vybestack\\llxprt-code\\bin\\llxprt',
    );
  });

  it('extractCmdShimTargets accepts forward-slash %dp0% paths (robustness)', () => {
    assertExtract(
      'extractCmdShimTargets',
      ['"%dp0%/../lib/node_modules/@vybestack/llxprt-code/bin/llxprt" %*'].join(
        '\n',
      ),
      '../lib/node_modules/@vybestack/llxprt-code/bin/llxprt',
    );
  });
});
