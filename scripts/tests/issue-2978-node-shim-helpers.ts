/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
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
  copyFileSync(process.execPath, exe);
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
  copyFileSync(process.execPath, exe);
  return exe;
}

export function placePlaceholder(nodeModules: string): void {
  const placeholder = path.join(nodeModules, 'bun', 'bin', 'bun.exe');
  mkdirSync(path.dirname(placeholder), { recursive: true });
  writeFileSync(
    placeholder,
    'echo "Error: Bun\'s postinstall script was not run." >&2\nexit 1\n',
  );
  chmodSync(placeholder, 0o755);
}

export function placeScriptDisabledBun(
  layout: Layout,
  hoisted: boolean,
): Record<string, string> {
  const localModules = path.join(layout.pkgRoot, 'node_modules');
  placePlaceholder(localModules);
  placePlaceholder(layout.nodeModules);
  for (const variant of hostOvenVariants()) {
    placeOvenBun(hoisted ? layout.nodeModules : localModules, variant);
  }
  if (isWin) return {};
  const node = spawnSync('node', ['-p', 'process.execPath'], {
    encoding: 'utf8',
  }).stdout.trim();
  const nodeOnly = path.join(layout.root, 'node-only');
  mkdirSync(nodeOnly);
  symlinkSync(node, path.join(nodeOnly, 'node'));
  return { PATH: nodeOnly };
}

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const captureChildOutput = [
  'const { closeSync, openSync } = require("node:fs");',
  'const { spawnSync } = require("node:child_process");',
  'const [stdoutPath, stderrPath, shimPath, ...args] = process.argv.slice(1);',
  'const stdoutFd = openSync(stdoutPath, "w");',
  'const stderrFd = openSync(stderrPath, "w");',
  'let status = 1;',
  'try {',
  '  status = spawnSync(process.execPath, [shimPath, ...args], { stdio: ["ignore", stdoutFd, stderrFd] }).status ?? 1;',
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
  // Outer process stays `node`: the shim's production contract is
  // `node <shim>` (its shebang is `#!/usr/bin/env node`), and under
  // `bun test` process.execPath would be bun, silently changing what is
  // under test. Inside the wrapper, process.execPath is this same node.
  const result = spawnSync(
    'node',
    ['-e', captureChildOutput, stdoutPath, stderrPath, layout.shim, ...args],
    {
      // The fixture root must not be any launched process's working
      // directory: Windows keeps a directory handle open for a process cwd
      // and refuses to remove the directory while the process is tearing down.
      cwd: path.dirname(layout.root),
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

export function isNativeExecutable(stdout: string, native: string): boolean {
  const output = parseEntryOutput(stdout);
  if (output === null) throw new Error(`Missing application output: ${stdout}`);
  return realpathSync(output.exe) === realpathSync(native);
}

export function parseHandleOwners(
  output: string,
): Array<{ image: string; pid: number; kind: string; handle: string }> {
  return [
    ...output.matchAll(
      /^(\S+)\s+pid:\s+(\d+)\s+type:\s+(\S+)\s+([\da-f]+):/gim,
    ),
  ].map((match) => ({
    image: path.win32.basename(match[1] ?? ''),
    pid: Number(match[2]),
    kind: match[3] ?? '',
    handle: match[4] ?? '',
  }));
}

export function throwShimCleanupError(
  error: unknown,
  fixture: string,
  deadline: number,
): never {
  if (
    !isWin ||
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'EBUSY'
  ) {
    throw error;
  }
  const emit = (details: object): void => {
    try {
      writeSync(2, `shim-cleanup-lock ${JSON.stringify(details)}\n`);
    } catch {
      // A closed CI diagnostic stream must not replace the cleanup exception.
    }
  };
  try {
    emit({
      phase: 'profile-afterEach',
      fixture: path.basename(fixture),
      pid: process.pid,
      ppid: process.ppid,
      at: new Date().toISOString(),
      owner: 'unproven',
    });
    const directory = lstatSync(fixture, { throwIfNoEntry: false });
    emit({
      directory: directory && {
        mode: directory.mode,
        size: directory.size,
        modified: directory.mtimeMs,
      },
    });
    const probe = (command: string, args: string[]): string => {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) throw new Error('diagnostic budget exhausted');
      const result = spawnSync(command, args, {
        encoding: 'utf8',
        timeout: Math.min(1000, remaining),
        maxBuffer: 32 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
        cwd: path.dirname(fixture),
        env: { ...process.env, LLXPRT_TEST_LOCK_PATH: fixture },
      });
      emit({
        probe: path.basename(command),
        status: result.status,
        signal: result.signal,
        failed: Boolean(result.error),
      });
      return result.status === 0 && !result.error ? result.stdout : '';
    };
    const script = [
      "$ErrorActionPreference='Stop'; $needle=[regex]::Escape($env:LLXPRT_TEST_LOCK_PATH);",
      `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${process.pid} -or ($_.ProcessId -ne $PID -and ($_.ExecutablePath -match $needle -or $_.CommandLine -match $needle)) } |`,
      "ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; image=[IO.Path]::GetFileName($_.ExecutablePath); started=$_.CreationDate.ToUniversalTime().ToString('o') } }) | ConvertTo-Json -Compress",
    ].join(' ');
    const processes = probe('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    const processCandidates: unknown = JSON.parse(processes || '[]');
    emit({ processCandidates });
    const handle = Bun.which('handle.exe') ?? Bun.which('handle64.exe');
    if (handle === null) {
      emit({ probe: 'handles', available: false });
    } else {
      const result = probe(handle, ['-nobanner', fixture]);
      emit({ handleOwners: parseHandleOwners(result) });
    }
  } catch {
    emit({ probeFailed: true });
  }
  throw error;
}

export function removeProfileFixture(tempDir: string): void {
  const deadline = performance.now() + 2000;
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    throwShimCleanupError(error, tempDir, deadline);
  }
}
