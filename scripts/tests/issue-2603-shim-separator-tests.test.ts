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

function loadCliInstaller(): ReturnType<typeof nodeRequire> {
  delete nodeRequire.cache[cliModulePath];
  return nodeRequire(cliModulePath);
}

describe('shim target extraction accepts both path separators', () => {
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
    const mod = loadCliInstaller();
    const content = [
      '$target = "$basedir\\..\\lib\\node_modules\\@vybestack\\llxprt-code\\bin\\llxprt"',
    ].join('\n');
    const targets = mod.extractPs1ShimTargets(content);
    expect(targets).toContain(
      '..\\lib\\node_modules\\@vybestack\\llxprt-code\\bin\\llxprt',
    );
  });

  it('extractCmdShimTargets accepts backslash %dp0% paths', () => {
    const mod = loadCliInstaller();
    const content = [
      '@echo off',
      '"/bin/sh.exe" "%dp0%\\..\\lib\\node_modules\\@vybestack\\llxprt-code\\bin\\llxprt" %*',
    ].join('\n');
    const targets = mod.extractCmdShimTargets(content);
    expect(targets).toContain(
      '..\\lib\\node_modules\\@vybestack\\llxprt-code\\bin\\llxprt',
    );
  });

  it('extractCmdShimTargets accepts forward-slash %dp0% paths (robustness)', () => {
    const mod = loadCliInstaller();
    const content = [
      '"%dp0%/../lib/node_modules/@vybestack/llxprt-code/bin/llxprt" %*',
    ].join('\n');
    const targets = mod.extractCmdShimTargets(content);
    expect(targets).toContain(
      '../lib/node_modules/@vybestack/llxprt-code/bin/llxprt',
    );
  });
});
