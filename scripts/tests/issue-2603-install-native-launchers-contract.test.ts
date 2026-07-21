/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

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
  return nodeRequire(cliModulePath);
}

describe('installNativeLaunchers return shape consistency', () => {
  it('returns error:null on POSIX no-op', () => {
    const mod = loadCliInstaller();
    const result = mod.installNativeLaunchers({
      platform: 'darwin',
      packageRoot: repoRoot,
      log: () => {},
    });
    expect(result.error).toBeNull();
    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it('returns bun-not-found when bundled Bun is absent', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-shape-nobun-'));
    try {
      const packageRoot = join(tempDir, 'pkg');
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(join(packageRoot, 'index.ts'), '// entry');
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: {},
        log: () => {},
      });
      expect(result.error).toBe('bun-not-found');
      expect(result.written).toEqual([]);
      expect(result.skipped).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns entry-not-found when entry is absent', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-shape-noentry-'));
    try {
      const packageRoot = join(tempDir, 'pkg');
      mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
        recursive: true,
      });
      writeFileSync(
        join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
        'fake',
      );
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: {},
        log: () => {},
      });
      expect(result.error).toBe('entry-not-found');
      expect(result.written).toEqual([]);
      expect(result.skipped).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns error:null on a successful win32 install', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-shape-ok-'));
    try {
      const packageRoot = join(
        tempDir,
        'node_modules',
        '@vybestack',
        'llxprt-code',
      );
      mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
        recursive: true,
      });
      writeFileSync(
        join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
        'fake',
      );
      writeFileSync(join(packageRoot, 'index.ts'), '// entry');
      mkdirSync(join(tempDir, 'node_modules', '.bin'), { recursive: true });
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: {},
        log: () => {},
      });
      expect(result.error).toBeNull();
      expect(result.written.length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('installNativeLaunchers logging', () => {
  it('logs skipped foreign launcher paths via the log callback', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-log-skip-'));
    try {
      const packageRoot = join(
        tempDir,
        'node_modules',
        '@vybestack',
        'llxprt-code',
      );
      mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
        recursive: true,
      });
      writeFileSync(
        join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
        'fake',
      );
      writeFileSync(join(packageRoot, 'index.ts'), '// entry');
      const dotBin = join(tempDir, 'node_modules', '.bin');
      mkdirSync(dotBin, { recursive: true });
      const foreignCmd = join(dotBin, 'llxprt.cmd');
      writeFileSync(
        foreignCmd,
        '@echo off' + String.fromCharCode(10) + 'echo someone else',
      );
      const messages: string[] = [];
      mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: {},
        log: (msg: string) => messages.push(msg),
      });
      const skipMsg = messages.find((m) => m.includes(foreignCmd));
      expect(skipMsg, messages.join(String.fromCharCode(10))).toBeDefined();
      expect(skipMsg).toMatch(/Skipped foreign/i);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('propagates the log callback to launcher writes (chmod warning is best-effort)', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-log-chmod-'));
    try {
      const packageRoot = join(
        tempDir,
        'node_modules',
        '@vybestack',
        'llxprt-code',
      );
      mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
        recursive: true,
      });
      writeFileSync(
        join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
        'fake',
      );
      writeFileSync(join(packageRoot, 'index.ts'), '// entry');
      const dotBin = join(tempDir, 'node_modules', '.bin');
      mkdirSync(dotBin, { recursive: true });
      const messages: string[] = [];
      // A successful write still surfaces via the written summary log.
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: {},
        log: (msg: string) => messages.push(msg),
      });
      expect(result.error).toBeNull();
      expect(result.written.length).toBeGreaterThan(0);
      // The summary "Wrote N native launcher" message is emitted via log.
      const wroteMsg = messages.find((m) =>
        /Wrote \d+ native launcher/.test(m),
      );
      expect(wroteMsg, messages.join(String.fromCharCode(10))).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
