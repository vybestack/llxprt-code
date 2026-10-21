/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

function cleanupInstaller(): void {
  try {
    rmSync(toolRoot, { recursive: true, force: true });
  } catch (error) {
    try {
      process.stderr.write(
        `[checkout-plugin-cleanup] ${JSON.stringify({
          toolRoot,
          home,
          pid: process.pid,
          parentPid: process.ppid,
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
