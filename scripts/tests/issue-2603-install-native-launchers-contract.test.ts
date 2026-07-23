/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from 'node:fs';
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
  const mod = nodeRequire(cliModulePath);
  // Implementation-detail helpers are exposed under a private `_testing`
  // namespace; merge them onto the top-level return for legacy `mod.X` access.
  return { ...mod, ...mod._testing };
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
      writeFileSync(foreignCmd, '@echo off\necho someone else');
      const messages: string[] = [];
      mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: {},
        log: (msg: string) => messages.push(msg),
      });
      const skipMsg = messages.find((m) => m.includes(foreignCmd));
      expect(skipMsg, messages.join('\n')).toBeDefined();
      expect(skipMsg).toMatch(/Skipped foreign/i);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('repairs a zero-byte existing launcher (truncated install recovery)', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-zero-byte-'));
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
      // A zero-byte file cannot be a valid foreign shim (no sentinel, no
      // target reference). The installer must repair it.
      const zeroByteCmd = join(dotBin, 'llxprt.cmd');
      writeFileSync(zeroByteCmd, '');
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: {},
        log: () => {},
      });
      expect(result.written).toContain(zeroByteCmd);
      const content = readFileSync(zeroByteCmd, 'utf8');
      expect(content).toContain(mod.OWNERSHIP_SENTINEL);
      expect(content.length).toBeGreaterThan(0);
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
      expect(wroteMsg, messages.join('\n')).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('installNativeLaunchers EACCES graceful handling', () => {
  it('does not crash when a foreign shim is unreadable (EACCES)', () => {
    // A foreign shim that exists but is unreadable (EACCES) must be treated
    // as non-overwritable rather than crashing postinstall. The installer
    // must skip it gracefully and return it in the skipped list.
    if (process.platform === 'win32') {
      // chmod 0 does not reliably prevent reads on Windows; skip on win32.
      return;
    }
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-eacces-'));
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
      const unreadableCmd = join(dotBin, 'llxprt.cmd');
      // Write a foreign shim (no sentinel, no package target reference).
      writeFileSync(unreadableCmd, '@echo off\necho foreign shim');
      // Remove read permission so reading throws EACCES.
      chmodSync(unreadableCmd, 0o000);
      // The install must not throw; the unreadable file must be skipped.
      const result = mod.installNativeLaunchers({
        platform: 'win32',
        packageRoot,
        env: {},
        log: () => {},
      });
      expect(result.error).toBeNull();
      expect(result.skipped).toContain(unreadableCmd);
    } finally {
      // Restore permission before cleanup so rmSync can remove the file.
      try {
        chmodSync(join(tempDir, 'node_modules', '.bin', 'llxprt.cmd'), 0o644);
      } catch {
        // ignore
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
