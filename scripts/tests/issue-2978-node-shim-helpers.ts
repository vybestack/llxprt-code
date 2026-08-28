/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(thisFile, '..', '..', '..');
export const shimSrc = path.join(
  repoRoot,
  'packages',
  'cli',
  'bin',
  'llxprt.mjs',
);
export const cliManifestPath = path.join(
  repoRoot,
  'packages',
  'cli',
  'package.json',
);
const stubBun = path.join(repoRoot, 'node_modules', 'bun', 'bin', 'bun.exe');

function requireStubBun(): string {
  if (!existsSync(stubBun)) {
    throw new Error(
      `Expected the bun package's native binary at ${stubBun}. ` +
        'Run `npm install` to restore it before running this suite.',
    );
  }
  return stubBun;
}

export const LAUNCH_TIMEOUT_MS = 30_000;
export const LAUNCHER_FAILURE_EXIT = 43;
export const isWin = process.platform === 'win32';
const bunExeName = 'bun.exe';

export interface Layout {
  readonly root: string;
  readonly pkgRoot: string;
  readonly nodeModules: string;
  readonly shim: string;
}

export function makeLayout(root: string): Layout {
  const nodeModules = path.join(root, 'node_modules');
  const pkgRoot = path.join(nodeModules, '@vybestack', 'llxprt-code');
  const binDir = path.join(pkgRoot, 'bin');
  mkdirSync(binDir, { recursive: true });
  copyFileSync(shimSrc, path.join(binDir, 'llxprt.mjs'));
  return { root, pkgRoot, nodeModules, shim: path.join(binDir, 'llxprt.mjs') };
}

export const defaultEntryBody =
  'console.log(JSON.stringify({exe:process.execPath,argv:process.argv.slice(2)}));' +
  'let c=Number(process.env.LLXPRT_TEST_EXIT||"0");if(c)process.exit(c);';

export function writeSourceEntry(pkgRoot: string, body: string): void {
  writeFileSync(path.join(pkgRoot, 'index.ts'), body);
}

export function writeBundleEntry(pkgRoot: string, body: string): void {
  const dir = path.join(pkgRoot, 'bundle');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'llxprt.js'), body);
}

export type ProfilerArtifact =
  | 'memprofile-launcher.js'
  | 'memprofile-preload.js'
  | 'memprofile-request.js'
  | 'memprofile-report.js'
  | 'memprofile-analyze.js';

export function writeProfilerEntry(
  pkgRoot: string,
  artifact: ProfilerArtifact,
  marker: string,
): void {
  const dir = path.join(pkgRoot, 'bundle');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, artifact),
    `console.log(${JSON.stringify(marker)});${defaultEntryBody}`,
  );
}

export function writeProfileLauncher(pkgRoot: string, marker: string): void {
  writeProfilerEntry(pkgRoot, 'memprofile-launcher.js', marker);
  writeProfilerEntry(
    pkgRoot,
    'memprofile-preload.js',
    'PROFILE_PRELOAD_PRESENT',
  );
  const cliBundle = path.join(pkgRoot, 'bundle', 'llxprt.js');
  if (!existsSync(cliBundle)) {
    writeBundleEntry(pkgRoot, 'console.log("PROFILE_CLI_PRESENT");');
  }
}

export function placeBundledBun(nodeModules: string): string {
  const dir = path.join(nodeModules, 'bun', 'bin');
  mkdirSync(dir, { recursive: true });
  const exe = path.join(dir, bunExeName);
  copyFileSync(requireStubBun(), exe);
  return exe;
}

export function hostOvenVariants(): string[] {
  const key = `${process.platform}-${process.arch}`;
  const map: Record<string, string[]> = {
    'darwin-arm64': ['bun-darwin-aarch64'],
    'darwin-x64': ['bun-darwin-x64', 'bun-darwin-x64-baseline'],
    'linux-arm64': ['bun-linux-aarch64', 'bun-linux-aarch64-musl'],
    'linux-x64': [
      'bun-linux-x64',
      'bun-linux-x64-baseline',
      'bun-linux-x64-musl',
      'bun-linux-x64-musl-baseline',
    ],
    'win32-arm64': ['bun-windows-aarch64'],
    'win32-x64': ['bun-windows-x64', 'bun-windows-x64-baseline'],
  };
  return map[key] ?? [];
}

export function placeOvenBun(nodeModules: string, variant: string): string {
  const pkgDir = path.join(nodeModules, '@oven', variant);
  const binDir = path.join(pkgDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: `@oven/${variant}`, version: '1.3.14' }),
  );
  const exe = path.join(binDir, bunExeName);
  copyFileSync(requireStubBun(), exe);
  return exe;
}

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const captureChildOutput = [
  'const { closeSync, openSync } = require("node:fs");',
  'const { spawnSync } = require("node:child_process");',
  'const [stdoutPath, stderrPath, command, ...args] = process.argv.slice(1);',
  'const stdoutFd = openSync(stdoutPath, "w");',
  'const stderrFd = openSync(stderrPath, "w");',
  'let status = 1;',
  'try {',
  '  status = spawnSync(command, args, { stdio: ["ignore", stdoutFd, stderrFd] }).status ?? 1;',
  '} finally {',
  '  closeSync(stdoutFd);',
  '  closeSync(stderrFd);',
  '}',
  'process.exit(status);',
].join('\n');

export function readCapture(pathname: string, spawnError?: Error): string {
  const captured = existsSync(pathname) ? readFileSync(pathname, 'utf8') : '';
  if (spawnError === undefined) {
    return captured;
  }
  return `${captured}${captured.endsWith('\n') || captured === '' ? '' : '\n'}wrapper spawn failed: ${spawnError.message}\n`;
}

export function runShim(
  layout: Layout,
  args: readonly string[] = [],
  extraEnv: Record<string, string> = {},
): RunResult {
  const stdoutPath = path.join(layout.root, 'shim-stdout.log');
  const stderrPath = path.join(layout.root, 'shim-stderr.log');
  writeFileSync(stdoutPath, '');
  writeFileSync(stderrPath, '');
  const result = spawnSync(
    'node',
    ['-e', captureChildOutput, stdoutPath, stderrPath, layout.shim, ...args],
    {
      cwd: layout.root,
      timeout: LAUNCH_TIMEOUT_MS,
      env: { ...process.env, ...extraEnv },
      stdio: 'ignore',
      ...(isWin ? { windowsHide: true } : {}),
    },
  );
  return {
    status: result.status,
    stdout: readCapture(stdoutPath),
    stderr: readCapture(stderrPath, result.error),
  };
}

export function parseEntryOutput(
  stdout: string,
): { exe: string; argv: string[] } | null {
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.trim().startsWith('{'));
  if (line === undefined) {
    return null;
  }
  try {
    return JSON.parse(line) as { exe: string; argv: string[] };
  } catch {
    return null;
  }
}
