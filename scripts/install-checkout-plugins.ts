/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { FIRST_PARTY_RUNTIME_PLUGIN_RELEASES } from './utils/release-packages.ts';
import {
  superviseChild,
  type SupervisedChild,
} from './utils/supervised-child.ts';

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

const privateImagePath = join(
  toolRoot,
  'bin',
  process.platform === 'win32' ? 'bun.exe' : 'bun',
);

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

const processObserver =
  process.platform === 'win32' ? startProcessObserver() : undefined;

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
  await cleanupInstaller();
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
 * reason instead of collapsing to "no candidates", so a diagnostic reader
 * can tell an observer that never answered from a query failure.
 */
interface NativeProcessProbe {
  readonly observerPid: number | undefined;
  readonly error: string | undefined;
  readonly budgetMs: number;
  readonly elapsedMs: number;
  readonly processCandidates: readonly NativeProcessCandidate[] | null;
}

/**
 * A PowerShell process started before the installer runs. Launching
 * powershell.exe and loading its CIM provider takes seconds on a cold
 * Windows runner, which does not fit in the 2 second cleanup budget. The
 * observer pays that cost while the installer works, then waits for a
 * request file and answers with one process snapshot, so cleanup only
 * writes a file and reads the reply.
 */
interface ProcessObserver extends SupervisedChild {
  readonly child: ChildProcess;
  readonly requestPath: string;
  readonly responsePath: string;
}

function powerShellString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function processObserverScript(
  image: string,
  requestPath: string,
  responsePath: string,
): string {
  // The snapshot is one CIM query, indexed by pid, so the ancestor walk is
  // hash lookups rather than a pipeline scan per step. The warm-up query
  // loads the CIM provider before the observer starts waiting.
  const snapshot = [
    '$byId=@{}; $selected=@{};',
    'foreach ($p in Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,ExecutablePath,CreationDate) { $byId[[int]$p.ProcessId]=$p };',
    `foreach ($p in $byId.Values) { if ($p.ExecutablePath -eq $image) { $selected[[int]$p.ProcessId]='exact-private-bun' } elseif ($p.ProcessId -eq ${process.pid}) { $selected[[int]$p.ProcessId]='installer' } };`,
    "foreach ($id in @($selected.Keys)) { $seen=@{}; $p=$byId[[int]$id]; while ($p -and -not $seen.ContainsKey([int]$p.ProcessId)) { $seen[[int]$p.ProcessId]=$true; $p=$byId[[int]$p.ParentProcessId]; if ($p -and -not $selected.ContainsKey([int]$p.ProcessId)) { $selected[[int]$p.ProcessId]='ancestor-candidate' } } };",
    "@($selected.Keys | ForEach-Object { $p=$byId[[int]$_]; [pscustomobject]@{ pid=$p.ProcessId; parentPid=$p.ParentProcessId; created=$p.CreationDate.ToUniversalTime().ToString('o'); image=[IO.Path]::GetFileName($p.ExecutablePath); role=$selected[[int]$_] } })",
  ].join(' ');
  return [
    "$ErrorActionPreference='Stop';",
    `$image=${powerShellString(image)};`,
    `$request=${powerShellString(requestPath)};`,
    `$response=${powerShellString(responsePath)};`,
    `$installer=[Diagnostics.Process]::GetProcessById(${process.pid});`,
    `$null=& { ${snapshot} };`,
    'while (-not (Test-Path -LiteralPath $request)) { if ($installer.HasExited) { exit 0 }; Start-Sleep -Milliseconds 20 };',
    `try { $body=[pscustomobject]@{ error=$null; candidates=@(& { ${snapshot} }) } } catch { $body=[pscustomobject]@{ error=$_.Exception.Message; candidates=$null } };`,
    "$staged=$response + '.tmp'; [IO.File]::WriteAllText($staged, (ConvertTo-Json -Compress -Depth 4 -InputObject $body));",
    'Move-Item -LiteralPath $staged -Destination $response',
  ].join(' ');
}

function startProcessObserver(): ProcessObserver {
  const requestPath = join(toolRoot, 'observer.request');
  const responsePath = join(toolRoot, 'observer.response');
  const child = spawn(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      processObserverScript(privateImagePath, requestPath, responsePath),
    ],
    { cwd: repoRoot, stdio: 'ignore', windowsHide: true },
  );
  // A failed spawn leaves the pid undefined, which the probe reports.
  return { child, requestPath, responsePath, ...superviseChild(child) };
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function parseObserverResponse(
  text: string,
): Pick<NativeProcessProbe, 'error' | 'processCandidates'> {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('candidates' in parsed)
  )
    return { error: 'Unrecognized process snapshot', processCandidates: null };
  const { candidates } = parsed;
  const reported =
    'error' in parsed && typeof parsed.error === 'string'
      ? parsed.error
      : undefined;
  return {
    error: reported,
    processCandidates: Array.isArray(candidates) ? candidates : null,
  };
}

function probeNativeProcesses(
  observer: ProcessObserver,
  budgetMs: number,
): NativeProcessProbe {
  const startedAt = performance.now();
  const observerPid = observer.child.pid;
  const finish = (
    outcome: Pick<NativeProcessProbe, 'error' | 'processCandidates'>,
  ): NativeProcessProbe => ({
    observerPid,
    budgetMs,
    elapsedMs: Math.round(performance.now() - startedAt),
    ...outcome,
  });
  if (observerPid === undefined)
    return finish({
      error: 'Process observer failed to start',
      processCandidates: null,
    });
  writeFileSync(observer.requestPath, '');
  while (performance.now() - startedAt < budgetMs) {
    if (existsSync(observer.responsePath))
      return finish(
        parseObserverResponse(readFileSync(observer.responsePath, 'utf8')),
      );
    sleepSync(10);
  }
  return finish({
    error: 'Process observer did not answer within the cleanup budget',
    processCandidates: null,
  });
}

function privateImageContext(deadline: number): object {
  const path = privateImagePath;
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
  if (processObserver === undefined) return context;
  const remaining = Math.floor(deadline - performance.now());
  if (remaining <= 0) return { ...context, probe: { budgetExhausted: true } };
  return {
    ...context,
    probe: probeNativeProcesses(processObserver, remaining),
  };
}

async function cleanupInstaller(): Promise<void> {
  const deadline = performance.now() + 2000;
  let removal: { readonly error: unknown } | undefined;
  try {
    rmSync(toolRoot, { recursive: true, force: true });
  } catch (error) {
    removal = { error };
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
      // The diagnostic is best effort; the removal error is rethrown below.
    }
  }
  const shutdown = await stopProcessObserver();
  if (removal !== undefined) throw removal.error;
  if (shutdown !== undefined) throw shutdown.error;
}

/** Observer shutdown never throws, so it cannot replace the removal error. */
async function stopProcessObserver(): Promise<{ error: unknown } | undefined> {
  try {
    await processObserver?.stop();
    return undefined;
  } catch (error) {
    return { error };
  }
}
