/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FIRST_PARTY_RUNTIME_PLUGIN_RELEASES } from './utils/release-packages.ts';

const repoRoot = resolve(import.meta.dirname, '..');
const temporaryRoot = join(repoRoot, 'tmp');
mkdirSync(temporaryRoot, { recursive: true });
const toolRoot = mkdtempSync(join(temporaryRoot, 'plugin-installer-'));
const home = join(toolRoot, 'home');
mkdirSync(home);
const environment = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: '0',
  BUN_INSTALL: toolRoot,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: home,
  BUN_NO_INSTALL_COMPLETIONS: '1',
};

interface InstallerCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error: string | undefined;
  readonly stdout: string;
  readonly stderr: string;
}

let commands: readonly InstallerCommand[] = [];

function run(command: string, args: string[], cwd: string): string {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  commands = [
    ...commands,
    {
      command,
      args,
      cwd,
      pid: result.pid,
      startedAt,
      completedAt: new Date().toISOString(),
      status: result.status,
      signal: result.signal,
      error: result.error?.message,
      stdout: result.stdout,
      stderr: result.stderr,
    },
  ];
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (status=${String(result.status)}, signal=${String(result.signal)}): ${result.stderr}${result.stdout}`,
    );
  }
  return result.stdout;
}

try {
  const windows = process.platform === 'win32';
  const installer = join(toolRoot, windows ? 'install.ps1' : 'install.sh');
  run(
    'curl',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--location',
      windows ? 'https://bun.sh/install.ps1' : 'https://bun.sh/install',
      '--output',
      installer,
    ],
    toolRoot,
  );
  if (windows) {
    run(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installer,
        '-Version',
        '1.4.2',
        '-NoPathUpdate',
        '-NoRegisterInstallation',
        '-NoCompletions',
      ],
      toolRoot,
    );
  } else {
    run('bash', [installer, 'bun-v1.4.2'], toolRoot);
  }
  const bun = join(toolRoot, 'bin', windows ? 'bun.exe' : 'bun');
  const version = run(bun, ['--version'], toolRoot).trim();
  if (version !== '1.4.2')
    throw new Error(`Plugin installer requires Bun 1.4.2, received ${version}`);
  for (const release of FIRST_PARTY_RUNTIME_PLUGIN_RELEASES) {
    run(
      bun,
      ['install', '--frozen-lockfile', '--omit=peer'],
      join(repoRoot, release.dir),
    );
  }
} finally {
  cleanupInstaller();
}

interface NativeProcessCandidate {
  readonly pid: number;
  readonly parentPid: number;
  readonly created: string;
  readonly image: string;
  readonly role: 'exact-private-bun' | 'installer' | 'ancestor-candidate';
}

/**
 * Outcome of the Windows process snapshot. A failed snapshot keeps its
 * status, signal, spawn error and PowerShell stderr instead of collapsing to
 * "no candidates", so a diagnostic reader can tell a timeout from a query
 * failure.
 */
interface NativeProcessProbe {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error: string | undefined;
  readonly stderr: string;
  readonly budgetMs: number;
  readonly elapsedMs: number;
  readonly processCandidates: readonly NativeProcessCandidate[] | null;
}

function nativeProcessSnapshotScript(image: string): string {
  // One CIM query, indexed by pid: the ancestor walk is hash lookups rather
  // than a pipeline scan per step, and only the properties used are fetched,
  // so the snapshot stays inside the shared cleanup budget on a cold start.
  return [
    "$ErrorActionPreference='Stop';",
    `$image='${image.replaceAll("'", "''")}';`,
    '$byId=@{}; $selected=@{};',
    'foreach ($p in Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath,CreationDate) { $byId[[int]$p.ProcessId]=$p };',
    `foreach ($p in $byId.Values) { if ($p.ExecutablePath -eq $image) { $selected[[int]$p.ProcessId]='exact-private-bun' } elseif ($p.ProcessId -eq ${process.pid}) { $selected[[int]$p.ProcessId]='installer' } };`,
    "foreach ($id in @($selected.Keys)) { $seen=@{}; $p=$byId[[int]$id]; while ($p -and -not $seen.ContainsKey([int]$p.ProcessId)) { $seen[[int]$p.ProcessId]=$true; $p=$byId[[int]$p.ParentProcessId]; if ($p -and -not $selected.ContainsKey([int]$p.ProcessId)) { $selected[[int]$p.ProcessId]='ancestor-candidate' } } };",
    "ConvertTo-Json -Compress -InputObject @($selected.Keys | ForEach-Object { $p=$byId[[int]$_]; [pscustomobject]@{ pid=$p.ProcessId; parentPid=$p.ParentProcessId; created=$p.CreationDate.ToUniversalTime().ToString('o'); image=[IO.Path]::GetFileName($p.ExecutablePath); role=$selected[[int]$_] } })",
  ].join(' ');
}

function probeNativeProcesses(
  image: string,
  budgetMs: number,
): NativeProcessProbe {
  const startedAt = performance.now();
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      nativeProcessSnapshotScript(image),
    ],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      windowsHide: true,
      timeout: budgetMs,
      maxBuffer: 32 * 1024,
    },
  );
  const elapsedMs = Math.round(performance.now() - startedAt);
  const common = {
    status: result.status,
    signal: result.signal,
    stderr: result.stderr,
    budgetMs,
    elapsedMs,
  };
  if (result.error !== undefined) {
    return {
      ...common,
      error: result.error.message,
      processCandidates: null,
    };
  }
  if (result.status !== 0) {
    return { ...common, error: undefined, processCandidates: null };
  }
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    return {
      ...common,
      error: undefined,
      processCandidates: Array.isArray(parsed) ? parsed : null,
    };
  } catch (parseError) {
    return {
      ...common,
      error: `Unparseable process snapshot: ${String(parseError)}`,
      processCandidates: null,
    };
  }
}

function privateImageContext(deadline: number): object {
  const path = join(
    toolRoot,
    'bin',
    process.platform === 'win32' ? 'bun.exe' : 'bun',
  );
  const file = lstatSync(path, { throwIfNoEntry: false });
  const context = {
    path,
    owner: 'unproven',
    metadata: file && {
      mode: file.mode,
      size: file.size,
      modified: file.mtimeMs,
    },
  };
  if (process.platform !== 'win32') return context;
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) return { ...context, probe: { budgetExhausted: true } };
  return { ...context, probe: probeNativeProcesses(path, remaining) };
}

function cleanupInstaller(): void {
  const deadline = performance.now() + 2000;
  try {
    rmSync(toolRoot, { recursive: true, force: true });
  } catch (error) {
    try {
      let privateImage: object;
      try {
        privateImage = privateImageContext(deadline);
      } catch {
        privateImage = { owner: 'unproven', probeFailed: true };
      }
      process.stderr.write(
        `[checkout-plugin-cleanup] ${JSON.stringify({
          toolRoot,
          home,
          pid: process.pid,
          parentPid: process.ppid,
          execPath: process.execPath,
          runtime: { node: process.versions.node, bun: process.versions.bun },
          privateImage,
          cwd: process.cwd(),
          platform: process.platform,
          commands,
        })}
`,
      );
    } catch {
      throw error;
    }
    throw error;
  }
}
