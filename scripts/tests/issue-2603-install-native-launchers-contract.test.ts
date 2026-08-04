/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  ensureBun,
  makeEntry,
  makeBundle,
  expectNoSpawnError,
} from './launcher-test-helpers.js';

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

describe('resolveEntry source guard (issue #2999)', () => {
  it('returns index.ts when source exists (source is the guaranteed fallback)', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-resolve-src-'));
    try {
      const packageRoot = join(tempDir, 'pkg');
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(join(packageRoot, 'index.ts'), '// source');
      const entry = mod.resolveEntry(packageRoot);
      expect(entry).toBe(join(packageRoot, 'index.ts'));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns index.ts even when a bundle also exists (bundle is runtime-decided)', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-resolve-both-'));
    try {
      const packageRoot = join(tempDir, 'pkg');
      mkdirSync(join(packageRoot, 'bundle'), { recursive: true });
      writeFileSync(join(packageRoot, 'bundle', 'llxprt.js'), '// bundle');
      writeFileSync(join(packageRoot, 'index.ts'), '// source');
      const entry = mod.resolveEntry(packageRoot);
      expect(entry).toBe(join(packageRoot, 'index.ts'));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns null when index.ts is absent (entry-not-found guard)', () => {
    const mod = loadCliInstaller();
    const tempDir = mkdtempSync(join(tmpdir(), 'llxprt-resolve-none-'));
    try {
      const packageRoot = join(tempDir, 'pkg');
      mkdirSync(packageRoot, { recursive: true });
      const entry = mod.resolveEntry(packageRoot);
      expect(entry).toBeNull();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// Issue #2999: bundle-vs-source precedence must be evaluated AT RUNTIME inside
// the generated launchers, not frozen at install time. These tests generate real
// launchers via the installer (computing the same %~dp0/$basedir-relative paths
// a real postinstall produces) and EXECUTE them against a real bundled bun.exe
// and distinguishable source/bundle markers, then assert on stdout and exit
// code. No mocks: the assertions can only pass if the emitted script text
// performs the precedence correctly.
const LAUNCHER_RUN_TIMEOUT_MS = 30_000;
const itWin32 = process.platform === 'win32' ? it : it.skip;

interface LaunchResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCmd(launcherPath: string, env: NodeJS.ProcessEnv): LaunchResult {
  // Invoke via `cmd.exe /s /c ""<path>""` rather than `shell: true`. Node's
  // shell:true interpolates the path unquoted, so an install directory
  // containing a cmd metacharacter (notably &) is split before the launcher
  // ever runs. The doubled-quote form is cmd's documented rule: with /s, cmd
  // strips exactly one leading and trailing quote and executes the remainder
  // verbatim, leaving the inner quotes to protect the path. This is caller-side
  // quoting and is independent of the launcher's own correctness.
  const result = spawnSync('cmd.exe', ['/s', '/c', `""${launcherPath}""`], {
    encoding: 'utf8',
    timeout: LAUNCHER_RUN_TIMEOUT_MS,
    env,
    windowsVerbatimArguments: true,
  });
  expectNoSpawnError(result);
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runPs1(launcherPath: string, env: NodeJS.ProcessEnv): LaunchResult {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcherPath],
    {
      encoding: 'utf8',
      timeout: LAUNCHER_RUN_TIMEOUT_MS,
      env,
      // Deliberately NOT windowsVerbatimArguments: unlike the cmd path above,
      // which hand-crafts cmd's doubled-quote form, `-File` relies on Node to
      // quote the path. Verbatim mode would disable that quoting and split any
      // launcher path containing a space -- reintroducing the exact class of
      // bug the quoted `set "VAR=value"` fix removed.
    },
  );
  expectNoSpawnError(result);
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.LLXPRT_FORCE_SOURCE_ENTRY;
  return env;
}

// Builds a realistic win32 package layout (real bundled bun.exe + source
// index.ts) and runs the installer to generate the native .cmd/.ps1 launchers
// in node_modules/.bin. The bundle is intentionally NOT created here so each
// test controls its presence independently (the installer bakes both paths and
// the launcher re-checks bundle presence at runtime).
function buildWin32Layout(
  tempDir: string,
  entryCode: string,
): {
  packageRoot: string;
  bundlePath: string;
  cmdPath: string;
  ps1Path: string;
} {
  const packageRoot = join(
    tempDir,
    'node_modules',
    '@vybestack',
    'llxprt-code',
  );
  mkdirSync(join(packageRoot, 'node_modules', 'bun', 'bin'), {
    recursive: true,
  });
  copyFileSync(
    ensureBun(),
    join(packageRoot, 'node_modules', 'bun', 'bin', 'bun.exe'),
  );
  makeEntry(packageRoot, entryCode);
  const dotBin = join(tempDir, 'node_modules', '.bin');
  mkdirSync(dotBin, { recursive: true });

  const mod = loadCliInstaller();
  const result = mod.installNativeLaunchers({
    platform: 'win32',
    packageRoot,
    env: {},
    log: () => {},
  });
  expect(result.error, 'native launcher generation must succeed').toBeNull();
  expect(existsSync(join(dotBin, 'llxprt.cmd'))).toBe(true);
  expect(existsSync(join(dotBin, 'llxprt.ps1'))).toBe(true);

  return {
    packageRoot,
    bundlePath: join(packageRoot, 'bundle', 'llxprt.js'),
    cmdPath: join(dotBin, 'llxprt.cmd'),
    ps1Path: join(dotBin, 'llxprt.ps1'),
  };
}

describe('Windows launcher runtime entry precedence (issue #2999)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-runtime-precedence-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  itWin32(
    'cmd: executes the prebuilt bundle when present and env var unset',
    () => {
      const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
      makeBundle(layout.packageRoot, `console.log('BUNDLE');`);
      const r = runCmd(layout.cmdPath, baseEnv());
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('BUNDLE');
    },
  );

  itWin32(
    'ps1: executes the prebuilt bundle when present and env var unset',
    () => {
      const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
      makeBundle(layout.packageRoot, `console.log('BUNDLE');`);
      const r = runPs1(layout.ps1Path, baseEnv());
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('BUNDLE');
    },
  );

  itWin32(
    'cmd: executes source when LLXPRT_FORCE_SOURCE_ENTRY=1 even with a bundle',
    () => {
      const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
      makeBundle(layout.packageRoot, `console.log('BUNDLE');`);
      const env = { ...baseEnv(), LLXPRT_FORCE_SOURCE_ENTRY: '1' };
      const r = runCmd(layout.cmdPath, env);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('SOURCE');
    },
  );

  itWin32(
    'ps1: executes source when LLXPRT_FORCE_SOURCE_ENTRY=1 even with a bundle',
    () => {
      const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
      makeBundle(layout.packageRoot, `console.log('BUNDLE');`);
      const env = { ...baseEnv(), LLXPRT_FORCE_SOURCE_ENTRY: '1' };
      const r = runPs1(layout.ps1Path, env);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('SOURCE');
    },
  );

  itWin32('cmd: falls back to source when the bundle is absent', () => {
    const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
    // No bundle created.
    const r = runCmd(layout.cmdPath, baseEnv());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('SOURCE');
  });

  itWin32('ps1: falls back to source when the bundle is absent', () => {
    const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
    // No bundle created.
    const r = runPs1(layout.ps1Path, baseEnv());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('SOURCE');
  });

  itWin32(
    'cmd: bundle deleted after generation still falls back to source (no exit 43)',
    () => {
      const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
      makeBundle(layout.packageRoot, `console.log('BUNDLE');`);
      // Remove the bundle AFTER the launcher was generated: this is the exact
      // regression issue #2999 fixes (install-time resolution previously baked
      // the bundle path and hard-failed with exit 43 at runtime).
      rmSync(layout.bundlePath, { force: true });
      const r = runCmd(layout.cmdPath, baseEnv());
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('SOURCE');
    },
  );

  itWin32(
    'ps1: bundle deleted after generation still falls back to source (no exit 43)',
    () => {
      const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
      makeBundle(layout.packageRoot, `console.log('BUNDLE');`);
      rmSync(layout.bundlePath, { force: true });
      const r = runPs1(layout.ps1Path, baseEnv());
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe('SOURCE');
    },
  );

  itWin32(
    'cmd: neither bundle nor source present exits 43 with the generalized message',
    () => {
      const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
      // Source existed at install time (required); remove it so neither entry
      // resolves at runtime.
      rmSync(layout.bundlePath, { force: true });
      rmSync(join(layout.packageRoot, 'index.ts'), { force: true });
      const r = runCmd(layout.cmdPath, baseEnv());
      expect(r.status, r.stderr).toBe(43);
      expect(r.stderr).toMatch(/entry point was not found/i);
      expect(r.stderr).not.toMatch(/index\.ts/);
    },
  );

  itWin32(
    'ps1: neither bundle nor source present exits 43 with the generalized message',
    () => {
      const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
      rmSync(layout.bundlePath, { force: true });
      rmSync(join(layout.packageRoot, 'index.ts'), { force: true });
      const r = runPs1(layout.ps1Path, baseEnv());
      expect(r.status, r.stderr).toBe(43);
      expect(r.stderr).toMatch(/entry point was not found/i);
      expect(r.stderr).not.toMatch(/index\.ts/);
    },
  );

  itWin32(
    'cmd: a nonzero exit from the entry (7) is propagated exactly, not turned into 43',
    () => {
      const layout = buildWin32Layout(tempDir, `process.exit(7);`);
      makeBundle(layout.packageRoot, `process.exit(7);`);
      const r = runCmd(layout.cmdPath, baseEnv());
      expect(r.status, r.stderr).toBe(7);
    },
  );

  itWin32(
    'ps1: a nonzero exit from the entry (7) is propagated exactly, not turned into 43',
    () => {
      const layout = buildWin32Layout(tempDir, `process.exit(7);`);
      makeBundle(layout.packageRoot, `process.exit(7);`);
      const r = runPs1(layout.ps1Path, baseEnv());
      expect(r.status, r.stderr).toBe(7);
    },
  );
});

describe('Windows launcher cmd-metacharacter paths (issue #2999)', () => {
  let tempDir: string;

  beforeEach(() => {
    // An install path containing '&' is the case that breaks an unquoted
    // `set VAR=value` in the generated cmd launcher: cmd would treat '&' as a
    // statement separator. Real installs hit this via user names such as
    // "John & Jane". escapeForCmdQuote only neutralizes '"' and '%', so the
    // generator must keep the assignment inside the quoted `set "VAR=value"`
    // form. Bare mkdtemp names never contain '&', so it needs explicit cover.
    tempDir = mkdtempSync(join(tmpdir(), 'llxprt-amp-'));
    tempDir = join(tempDir, 'a & b');
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  itWin32('cmd: resolves the bundle from a path containing "&"', () => {
    const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
    makeBundle(layout.packageRoot, `console.log('BUNDLE');`);
    const r = runCmd(layout.cmdPath, baseEnv());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('BUNDLE');
  });

  itWin32('cmd: falls back to source from a path containing "&"', () => {
    const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
    const r = runCmd(layout.cmdPath, baseEnv());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('SOURCE');
  });

  itWin32('ps1: resolves the bundle from a path containing "&"', () => {
    const layout = buildWin32Layout(tempDir, `console.log('SOURCE');`);
    makeBundle(layout.packageRoot, `console.log('BUNDLE');`);
    const r = runPs1(layout.ps1Path, baseEnv());
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('BUNDLE');
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
