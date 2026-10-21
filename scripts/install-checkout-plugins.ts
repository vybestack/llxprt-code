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
  const script = [
    "$ErrorActionPreference='Stop';",
    `$image='${path.replaceAll("'", "''")}';`,
    '$all=@(Get-CimInstance Win32_Process); $selected=@{};',
    `foreach ($p in $all) { if ($p.ExecutablePath -eq $image) { $selected[[int]$p.ProcessId]='exact-private-bun' } elseif ($p.ProcessId -eq ${process.pid}) { $selected[[int]$p.ProcessId]='installer' } };`,
    "foreach ($id in @($selected.Keys)) { $p=$all | Where-Object ProcessId -eq $id; $seen=@{}; while ($p -and -not $seen.ContainsKey([int]$p.ProcessId)) { $seen[[int]$p.ProcessId]=$true; $parent=$p.ParentProcessId; $p=$all | Where-Object ProcessId -eq $parent; if ($p -and -not $selected.ContainsKey([int]$p.ProcessId)) { $selected[[int]$p.ProcessId]='ancestor-candidate' } } };",
    "ConvertTo-Json -Compress -InputObject @($all | Where-Object { $selected.ContainsKey([int]$_.ProcessId) } | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; parentPid=$_.ParentProcessId; created=$_.CreationDate.ToUniversalTime().ToString('o'); image=[IO.Path]::GetFileName($_.ExecutablePath); role=$selected[[int]$_.ProcessId] } })",
  ].join(' ');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      windowsHide: true,
      timeout: Math.min(2000, remaining),
      maxBuffer: 32 * 1024,
    },
  );
  return {
    ...context,
    probe: {
      status: result.status,
      signal: result.signal,
      failed: result.error !== undefined,
      processCandidates:
        result.status === 0 && result.error === undefined
          ? JSON.parse(result.stdout)
          : null,
    },
  };
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
