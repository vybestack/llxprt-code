/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2978: behavioural coverage for the native Windows batch launcher at
 * packages/llxprt-cli-win32/bin/llxprt.cmd.
 *
 * npm v12 default-denies dependency install scripts, so the `bun` package's
 * postinstall (which places bun.exe) never runs for registry consumers. npm
 * still links bins, so @vybestack/llxprt-cli-win32 ships a batch launcher with
 * no Node dependency that resolves a Bun runtime itself. These tests execute
 * the REAL launcher against REAL directory trees containing a REAL runnable
 * stand-in executable; nothing is mocked.
 *
 * The stand-in is a copy of the genuine Bun binary. The launcher exec's it
 * against an entry script that prints process.execPath and process.argv, so the
 * selected candidate is identified by the absolute path Bun reports (proving
 * WHICH bun was chosen) and forwarded arguments are observed verbatim.
 *
 * Exit codes are captured by echoing cmd's %errorlevel% to stdout (delayed
 * expansion) from a throwaway wrapper batch, rather than relying on
 * spawnSync.status, which Bun does not reliably propagate for non-zero exits of
 * complex batch files. The whole suite is skipped on non-win32 because a .cmd
 * launcher cannot run elsewhere.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(thisFile, '..', '..', '..');
const launcherSrc = path.join(
  repoRoot,
  'packages',
  'llxprt-cli-win32',
  'bin',
  'llxprt.cmd',
);
const stubSrc = path.join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');
const comSpec = process.env.ComSpec ?? 'cmd.exe';
const system32 = path.join(process.env.SystemRoot ?? '', 'system32');
const LAUNCH_TIMEOUT_MS = 30_000;
// Carriage-return + line-feed for the throwaway wrapper batch, expressed without
// a backslash escape in source so write_file cannot corrupt it.
const CRLF = String.fromCharCode(13) + String.fromCharCode(10);
const EXIT_TOKEN = 'ZZ_EXITCODE_ZZ';
const EXIT_TOKEN_RE = /ZZ_EXITCODE_ZZ=(-?\d+)/;

const describeWin32 = process.platform === 'win32' ? describe : describe.skip;

// Normalize a path to forward slashes for comparison without writing a literal
// backslash into the source: path.sep is a single backslash on win32 (and a
// forward slash elsewhere), so splitting on it removes platform separators.
const norm = (value: string): string => value.split(path.sep).join('/');

const quoteArg = (arg: string): string =>
  arg.includes(' ') ? '"' + arg + '"' : arg;

type OvenVariant = 'bun-windows-x64' | 'bun-windows-x64-baseline';

interface Layout {
  readonly root: string;
  readonly mainPkg: string;
  readonly nodeModules: string;
  readonly launcher: string;
  readonly pathEnv: string;
}

/**
 * Builds the npm-installed shape the launcher expects to live in:
 *   <root>/node_modules/@vybestack/llxprt-cli-win32/bin/llxprt.cmd
 *   <root>/node_modules/@vybestack/llxprt-code/index.ts
 * The launcher anchors MAIN_PKG at %LAUNCHER_DIR%\..\..\llxprt-code, which only
 * resolves correctly when the bin sits two levels under @vybestack, so the tree
 * mirrors the published layout exactly.
 */
function buildLayout(root: string): Layout {
  const nodeModules = path.join(root, 'node_modules');
  const launcherDir = path.join(
    nodeModules,
    '@vybestack',
    'llxprt-cli-win32',
    'bin',
  );
  mkdirSync(launcherDir, { recursive: true });
  copyFileSync(launcherSrc, path.join(launcherDir, 'llxprt.cmd'));
  const mainPkg = path.join(nodeModules, '@vybestack', 'llxprt-code');
  mkdirSync(mainPkg, { recursive: true });
  // An empty directory used as the first PATH entry so a system Bun can never
  // leak into pass 3; system32 is appended only so `where` itself is runnable.
  const pathEnv = path.join(root, 'empty-path-dir');
  mkdirSync(pathEnv, { recursive: true });
  return {
    root,
    mainPkg,
    nodeModules,
    launcher: path.join(launcherDir, 'llxprt.cmd'),
    pathEnv,
  };
}

/**
 * Entry point the resolved Bun runs. It prints process.execPath (identifying
 * WHICH candidate ran) and the forwarded arguments, then optionally exits with
 * a code taken from LLXPRT_TEST_EXIT so exit-code propagation can be observed.
 */
function writeEntry(mainPkg: string): void {
  writeFileSync(
    path.join(mainPkg, 'index.ts'),
    'console.log(JSON.stringify({exe:process.execPath,argv:process.argv.slice(2)}));' +
      'var c=Number(process.env.LLXPRT_TEST_EXIT||"0");if(c)process.exit(c);',
  );
}

function placeBundledBun(nodeModules: string): string {
  const dir = path.join(nodeModules, 'bun', 'bin');
  mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, 'bun.exe');
  copyFileSync(stubSrc, exe);
  return exe;
}

function placeOvenBun(nodeModules: string, variant: OvenVariant): string {
  const dir = path.join(nodeModules, '@oven', variant, 'bin');
  mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, 'bun.exe');
  copyFileSync(stubSrc, exe);
  return exe;
}

/**
 * Runs the launcher through a throwaway wrapper batch that:
 *  - sets a controlled PATH (empty dir + system32) so a system Bun can never
 *    leak into pass 3's `where bun.exe`;
 *  - sets any extra env vars (e.g. LLXPRT_TEST_EXIT) for the child Bun;
 *  - echoes cmd's real %errorlevel% to stdout so the launcher's true exit code
 *    is captured as text, independent of any spawnSync.status quirk.
 *
 * PATH and the extra vars are set INSIDE the batch rather than via spawnSync's
 * `env` option because Bun's spawnSync does not reliably honour an overridden
 * PATH for the child process; setting them in the batch is applied by cmd
 * itself and inherited by the called launcher and its child Bun. The wrapper
 * lives in the layout temp tree and is removed with it in afterEach.
 */
function runLauncher(
  layout: Layout,
  args: readonly string[] = [],
  extraEnv: Record<string, string> = {},
): {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: Error;
} {
  const wrapper = path.join(layout.root, 'zz-exit-capture.cmd');
  const forwarded = args.length === 0 ? '' : ' ' + args.map(quoteArg).join(' ');
  const setLines = Object.entries(extraEnv).map(
    ([key, value]) => 'set "' + key + '=' + value + '"',
  );
  writeFileSync(
    wrapper,
    [
      '@echo off',
      'setlocal enableextensions enabledelayedexpansion',
      'set "PATH=' + layout.pathEnv + path.delimiter + system32 + '"',
      ...setLines,
      'call "' + layout.launcher + '"' + forwarded,
      'echo ' + EXIT_TOKEN + '=!errorlevel!',
      'endlocal',
    ].join(CRLF),
  );
  const result = spawnSync(comSpec, ['/c', wrapper], {
    cwd: layout.root,
    encoding: 'utf8',
    timeout: LAUNCH_TIMEOUT_MS,
    windowsHide: true,
  });
  // spawnSync leaves stdout/stderr null when the process fails to start; reading
  // .match() off null throws a TypeError that masks the real spawn error.
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const match = stdout.match(EXIT_TOKEN_RE);
  const exitCode = match ? Number(match[1]) : -1;
  return {
    exitCode,
    stdout,
    stderr,
    error: result.error,
  };
}

function parseMarker(stdout: string): { exe: string; argv: string[] } {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) {
    throw new Error(`no marker JSON in output: ${stdout}`);
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as {
    exe: unknown;
    argv: unknown;
  };
  if (typeof parsed.exe !== 'string' || !Array.isArray(parsed.argv)) {
    throw new Error(`unexpected entry output: ${stdout}`);
  }
  return { exe: parsed.exe, argv: parsed.argv as string[] };
}

describeWin32(
  'issue #2978 Windows launcher (bin/llxprt.cmd) — bun resolution',
  () => {
    let tempRoot: string;

    beforeEach(() => {
      tempRoot = mkdtempSync(path.join(tmpdir(), 'llxprt-win32-launcher-'));
    });

    afterEach(() => {
      rmSync(tempRoot, { recursive: true, force: true });
    });

    it('invokes the bundled node_modules/bun/bin/bun.exe when present', () => {
      const layout = buildLayout(path.join(tempRoot, 'consumer'));
      writeEntry(layout.mainPkg);
      const bundled = placeBundledBun(layout.nodeModules);
      const result = runLauncher(layout);
      expect(result.error).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(norm(parseMarker(result.stdout).exe)).toBe(norm(bundled));
    });

    it('falls back to @oven/bun-windows-x64 when no bundled bun exists', () => {
      const layout = buildLayout(path.join(tempRoot, 'consumer'));
      writeEntry(layout.mainPkg);
      const oven = placeOvenBun(layout.nodeModules, 'bun-windows-x64');
      const result = runLauncher(layout);
      expect(result.error).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(norm(parseMarker(result.stdout).exe)).toBe(norm(oven));
    });

    it('prefers the bundled bun over @oven when both are present', () => {
      const layout = buildLayout(path.join(tempRoot, 'consumer'));
      writeEntry(layout.mainPkg);
      const bundled = placeBundledBun(layout.nodeModules);
      const oven = placeOvenBun(layout.nodeModules, 'bun-windows-x64');
      const result = runLauncher(layout);
      expect(result.error).toBeUndefined();
      expect(result.exitCode).toBe(0);
      const exe = norm(parseMarker(result.stdout).exe);
      expect(exe).toBe(norm(bundled));
      expect(exe).not.toBe(norm(oven));
    });

    it('finds the bun-windows-x64-baseline variant when only it exists', () => {
      const layout = buildLayout(path.join(tempRoot, 'consumer'));
      writeEntry(layout.mainPkg);
      const baseline = placeOvenBun(
        layout.nodeModules,
        'bun-windows-x64-baseline',
      );
      const result = runLauncher(layout);
      expect(result.error).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(norm(parseMarker(result.stdout).exe)).toBe(norm(baseline));
    });

    it('finds a bun located several ancestor directories above the package', () => {
      const layout = buildLayout(
        path.join(tempRoot, 'deep', 'a', 'b', 'c', 'consumer'),
      );
      writeEntry(layout.mainPkg);
      const bundled = placeBundledBun(path.join(tempRoot, 'node_modules'));
      const result = runLauncher(layout);
      expect(result.error).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(norm(parseMarker(result.stdout).exe)).toBe(norm(bundled));
    });

    it('forwards arguments verbatim, including an argument with a space', () => {
      const layout = buildLayout(path.join(tempRoot, 'consumer'));
      writeEntry(layout.mainPkg);
      placeBundledBun(layout.nodeModules);
      const args = ['--flag', 'value with space', 'plain'];
      const result = runLauncher(layout, args);
      expect(result.error).toBeUndefined();
      expect(result.exitCode).toBe(0);
      expect(parseMarker(result.stdout).argv).toEqual(args);
    });

    // The launcher's final line must use %RC% rather than !RC!: delayed
    // expansion resolves after endlocal has already discarded the local scope,
    // which silently swallowed every non-zero exit code. Parse-time %RC%
    // expansion captures the value while the scope is still alive.
    it('propagates the child process non-zero exit code', () => {
      const layout = buildLayout(path.join(tempRoot, 'consumer'));
      writeEntry(layout.mainPkg);
      placeBundledBun(layout.nodeModules);
      const result = runLauncher(layout, [], { LLXPRT_TEST_EXIT: '7' });
      expect(result.exitCode).toBe(7);
    });

    it('exits non-zero and mentions bun when no runtime is found and PATH has none', () => {
      const layout = buildLayout(path.join(tempRoot, 'consumer'));
      writeEntry(layout.mainPkg);
      const result = runLauncher(layout);
      expect(result.error).toBeUndefined();
      // Greater-than-zero (not just not-zero) so a capture failure (-1 sentinel)
      // cannot make this pass for the wrong reason.
      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.stderr).toMatch(/bun/i);
    });
  },
);
