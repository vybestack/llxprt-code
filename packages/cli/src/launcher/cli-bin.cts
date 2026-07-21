#!/usr/bin/env node
'use strict';

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, win32 } from 'node:path';
import {
  classifyWindowsPathCandidates,
  isWindowsBunWrapper,
  orderWindowsBunCandidates,
  type WindowsBunCandidate,
} from './bun-candidate-policy.js';

function runtimeModuleFilename(currentModule: NodeJS.Module): string {
  return currentModule.filename;
}

const launcherDir = dirname(runtimeModuleFilename(module));
const BUN_RELAUNCH_ENV = 'LLXPRT_BUN_RELAUNCHED';
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = [
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGBREAK',
];
const SIGHUP_SELF_EXIT_DELAY_MS = 5_000;
const ORPHAN_CHECK_INTERVAL_MS = 10_000;
const SIGHUP_EXIT_CODE = 129;
const SIGNAL_EXIT_CODES: Readonly<Partial<Record<NodeJS.Signals, number>>> = {
  SIGHUP: SIGHUP_EXIT_CODE,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGILL: 132,
  SIGTRAP: 133,
  SIGABRT: 134,
  SIGBUS: 135,
  SIGFPE: 136,
  SIGKILL: 137,
  SIGUSR1: 138,
  SIGSEGV: 139,
  SIGUSR2: 140,
  SIGPIPE: 141,
  SIGALRM: 142,
  SIGTERM: 143,
  SIGBREAK: 149,
};

type ExitFunction = (code: number) => void;
type PathResolver = () => string | null;

interface RunCliBinOptions {
  readonly exit?: ExitFunction;
  readonly spawn?: typeof spawn;
  readonly resolveBun?: PathResolver;
  readonly resolveEntry?: PathResolver;
  readonly getPpid?: () => number;
  readonly selfExitDelayMs?: number;
  readonly orphanCheckIntervalMs?: number;
}

interface ChildHandlerOptions {
  readonly getPpid?: () => number;
  readonly selfExitDelayMs?: number;
  readonly orphanCheckIntervalMs?: number;
}

interface ChildExitInfo {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface SpawnInvocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: true;
}

type SpawnInvocationResult = SpawnInvocation | { readonly error: string };

function ancestors(startDir: string): readonly string[] {
  const dirs = [];
  let dir = startDir;
  while (dir !== dirname(dir)) {
    dirs.push(dir);
    dir = dirname(dir);
  }
  dirs.push(dir);
  return dirs;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return isSpawnableUnixCandidate(path);
  } catch {
    return false;
  }
}

function isSpawnableUnixCandidate(path: string): boolean {
  if (process.platform === 'win32') {
    return true;
  }
  try {
    const firstBytes = readFileSync(path).subarray(0, 4);
    const magic = firstBytes.toString('hex');
    return (
      firstBytes.toString('utf8').startsWith('#!') ||
      magic === '7f454c46' ||
      magic === 'cffaedfe' ||
      magic === 'feedfacf'
    );
  } catch {
    return false;
  }
}

function resolveEntry(): string | null {
  // The launcher always lives at <package root>/bin/llxprt.cjs, so the
  // package's own entry point is a sibling of this file's directory. This
  // covers the published standalone package layout, where the install
  // directory is named after the package (not "cli").
  const packageRootEntry = join(dirname(launcherDir), 'index.ts');
  if (isFile(packageRootEntry)) {
    return packageRootEntry;
  }

  for (const dir of ancestors(launcherDir)) {
    const packageEntry = join(dir, 'index.ts');
    if (isFile(packageEntry) && basename(dir) === 'cli') {
      return packageEntry;
    }

    const repositoryEntry = join(dir, 'packages', 'cli', 'index.ts');
    if (isFile(repositoryEntry)) {
      return repositoryEntry;
    }
  }
  return null;
}

function bunNames(): readonly string[] {
  return ['bun'];
}

function directBunNames(): readonly string[] {
  // The npm package installs bun.exe, while the bare name supports layouts
  // that retain the platform package's original POSIX executable name.
  return ['bun.exe', 'bun'];
}

function resolveBunFromNodeModules(): string | null {
  for (const dir of ancestors(launcherDir)) {
    for (const name of bunNames()) {
      const candidate = join(dir, 'node_modules', '.bin', name);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
    for (const name of directBunNames()) {
      const candidate = join(dir, 'node_modules', 'bun', 'bin', name);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function pathLookupTool(): string {
  if (process.platform !== 'win32') {
    return 'which';
  }
  const systemRoot = process.env['SystemRoot'];
  return systemRoot !== undefined && win32.isAbsolute(systemRoot)
    ? win32.join(systemRoot, 'System32', 'where.exe')
    : 'where.exe';
}

function pathCandidates(): readonly string[] {
  // Execute where.exe/which directly so a shell cannot reinterpret arguments.
  const result = spawnSync(pathLookupTool(), ['bun'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(["'])(.+?)\1$/, '$2'))
    .filter((candidate) => candidate.length > 0);
}

function resolveBunFromPath(): string | null {
  for (const candidate of pathCandidates()) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

function windowsNodeModuleCandidates(): readonly WindowsBunCandidate[] {
  return ancestors(launcherDir).flatMap((dir) => [
    {
      path: join(dir, 'node_modules', '.bin', 'bun.exe'),
      kind: 'bin-native',
    },
    {
      path: join(dir, 'node_modules', '.bin', 'bun.cmd'),
      kind: 'wrapper',
    },
    {
      path: join(dir, 'node_modules', 'bun', 'bin', 'bun.exe'),
      kind: 'direct-native',
    },
    {
      path: join(dir, 'node_modules', 'bun', 'bin', 'bun.cmd'),
      kind: 'wrapper',
    },
  ]);
}

function windowsPathCandidates(): readonly WindowsBunCandidate[] {
  return classifyWindowsPathCandidates(pathCandidates());
}

function firstUsableCandidate(
  candidates: readonly WindowsBunCandidate[],
): string | null {
  for (const candidate of candidates) {
    if (isExecutable(candidate.path)) {
      return candidate.path;
    }
  }
  return null;
}

function resolveWindowsBun(): string | null {
  const localCandidates = orderWindowsBunCandidates(
    windowsNodeModuleCandidates(),
  );
  const localNative = firstUsableCandidate(
    localCandidates.filter((candidate) => !isWindowsBunWrapper(candidate)),
  );
  if (localNative !== null) {
    return localNative;
  }
  return firstUsableCandidate(
    orderWindowsBunCandidates([
      ...localCandidates.filter(isWindowsBunWrapper),
      ...windowsPathCandidates(),
    ]),
  );
}

function resolveBun(): string | null {
  return process.platform === 'win32'
    ? resolveWindowsBun()
    : (resolveBunFromNodeModules() ?? resolveBunFromPath());
}

function hasWindowsCmdMetaCharacter(arg: string): boolean {
  return /[&|<>^()%!"\r\n]/.test(arg);
}

function isWindowsCmdShim(path: string): boolean {
  return (
    process.platform === 'win32' && basename(path).toLowerCase() === 'bun.cmd'
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bunLaunchErrorMessage(bunPath: string, error: unknown): string {
  return `Failed to launch Bun at "${bunPath}" (${describeError(error)}). Reinstall dependencies with "npm install" to restore the bundled Bun, or ensure a working Bun is executable and on your PATH (see https://bun.sh).`;
}

function fatalExit(exit: ExitFunction, message: string): void {
  process.stderr.write(`${message}\n`);
  exit(43);
}

function resolveBunOrFail(
  exit: ExitFunction,
  resolveBunFn: PathResolver | undefined,
): string | null {
  const bunPath = resolveBunFn === undefined ? resolveBun() : resolveBunFn();
  if (bunPath === null) {
    fatalExit(
      exit,
      'Bun runtime was not found. Install it with "npm install" (it is bundled as the "bun" dependency) or install Bun directly from https://bun.sh and ensure it is on your PATH.',
    );
    return null;
  }
  return bunPath;
}

function resolveEntryOrFail(
  exit: ExitFunction,
  resolveEntryFn: PathResolver | undefined,
): string | null {
  const entry =
    resolveEntryFn === undefined ? resolveEntry() : resolveEntryFn();
  if (entry === null) {
    fatalExit(
      exit,
      'Could not locate the LLxprt Code TypeScript entry point (packages/cli/index.ts). Your installation may be corrupt; reinstall @vybestack/llxprt-code.',
    );
    return null;
  }
  return entry;
}

function windowsCommandProcessor(): string {
  const systemRoot = process.env['SystemRoot'];
  return systemRoot !== undefined && win32.isAbsolute(systemRoot)
    ? win32.join(systemRoot, 'System32', 'cmd.exe')
    : 'cmd.exe';
}

function quoteWindowsCommandArgument(arg: string): string {
  const escapedTrailingBackslashes = arg.replace(/\\+$/, (backslashes) =>
    backslashes.repeat(2),
  );
  return `"${escapedTrailingBackslashes}"`;
}

function buildSpawnInvocation(
  bunPath: string,
  entry: string,
): SpawnInvocationResult {
  const args = [entry, ...process.argv.slice(2)];
  if (!isWindowsCmdShim(bunPath)) {
    return { command: bunPath, args };
  }
  if (hasWindowsCmdMetaCharacter(bunPath)) {
    return {
      error:
        'Cannot safely launch the bundled bun.cmd shim from a path containing Windows command-shell metacharacters. Install Bun directly so bun.exe is on PATH, or move the installation to a path without shell metacharacters.',
    };
  }
  if (args.some(hasWindowsCmdMetaCharacter)) {
    return {
      error:
        'Cannot safely forward arguments containing Windows command-shell metacharacters through the bundled bun.cmd shim. Install Bun directly so bun.exe is on PATH, or remove shell metacharacters from the CLI arguments.',
    };
  }
  const commandLine = [bunPath, ...args]
    .map(quoteWindowsCommandArgument)
    .join(' ');
  return {
    command: windowsCommandProcessor(),
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

function createChildEnv(): NodeJS.ProcessEnv {
  return { ...process.env, [BUN_RELAUNCH_ENV]: 'true' };
}

async function runCliBin(options: RunCliBinOptions = {}): Promise<void> {
  const exit = options.exit ?? process.exit;
  const spawnFn = options.spawn ?? spawn;

  const bunPath = resolveBunOrFail(exit, options.resolveBun);
  if (bunPath === null) {
    return;
  }

  const entry = resolveEntryOrFail(exit, options.resolveEntry);
  if (entry === null) {
    return;
  }

  const built = buildSpawnInvocation(bunPath, entry);
  if ('error' in built) {
    fatalExit(exit, built.error);
    return;
  }

  let child;
  try {
    child = spawnFn(built.command, built.args, {
      stdio: 'inherit',
      env: createChildEnv(),
      windowsVerbatimArguments: built.windowsVerbatimArguments,
    });
  } catch (error) {
    fatalExit(exit, bunLaunchErrorMessage(bunPath, error));
    return;
  }

  attachChildHandlers(child, bunPath, exit, {
    getPpid: options.getPpid,
    selfExitDelayMs: options.selfExitDelayMs,
    orphanCheckIntervalMs: options.orphanCheckIntervalMs,
  });
}

function attachChildHandlers(
  child: ChildProcess,
  bunPath: string,
  exit: ExitFunction,
  options: ChildHandlerOptions = {},
): void {
  let settled = false;
  let childExitInfo: ChildExitInfo | null = null;
  let hangupExitTimer: NodeJS.Timeout | null = null;
  let orphanCheckTimer: NodeJS.Timeout | null = null;

  const getPpid = options.getPpid ?? (() => process.ppid);
  const selfExitDelayMs = options.selfExitDelayMs ?? SIGHUP_SELF_EXIT_DELAY_MS;
  const orphanCheckIntervalMs =
    options.orphanCheckIntervalMs ?? ORPHAN_CHECK_INTERVAL_MS;

  const cleanupListeners = (): void => {
    child.off('close', onClose);
    child.off('error', onError);
    child.off('exit', onChildExit);
    for (const signal of FORWARDED_SIGNALS) {
      process.off(signal, forwardSignal);
    }
    process.off('beforeExit', onBeforeExit);
    if (hangupExitTimer !== null) {
      clearTimeout(hangupExitTimer);
      hangupExitTimer = null;
    }
    if (orphanCheckTimer !== null) {
      clearInterval(orphanCheckTimer);
      orphanCheckTimer = null;
    }
  };

  const prepareSettle = (): boolean => {
    if (settled) {
      return false;
    }
    settled = true;
    cleanupListeners();
    child.on('error', () => {});
    return true;
  };

  const settle = (exitCode: number): void => {
    if (!prepareSettle()) {
      return;
    }
    exit(exitCode);
  };

  const exitCodeFromChild = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): number => {
    if (code !== null) {
      return code;
    }
    if (signal !== null) {
      return SIGNAL_EXIT_CODES[signal] ?? 1;
    }
    return 1;
  };

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (settled) {
      return;
    }
    try {
      child.kill(signal);
    } catch {
      if (signal !== 'SIGHUP') {
        return;
      }
    }
    // SIGHUP indicates the controlling terminal is gone. After forwarding,
    // schedule a fallback self-exit so the shim cannot become an immortal
    // husk if the child's close event never fires (e.g. child already
    // reaped externally, or event loop stalled).
    if (signal === 'SIGHUP' && hangupExitTimer === null) {
      hangupExitTimer = setTimeout(() => {
        settle(SIGHUP_EXIT_CODE);
      }, selfExitDelayMs);
      hangupExitTimer.unref();
    }
  };

  const onClose = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    settle(exitCodeFromChild(code, signal));
  };

  const onError = (error: Error): void => {
    if (!prepareSettle()) {
      return;
    }
    try {
      child.kill('SIGTERM');
    } catch (killError) {
      process.stderr.write(
        `Failed to stop Bun after its spawn error (${describeError(killError)}).\n`,
      );
    }
    process.stderr.write(`${bunLaunchErrorMessage(bunPath, error)}
`);
    exit(43);
  };

  const onChildExit = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    childExitInfo = { code, signal };
  };

  const onBeforeExit = (): void => {
    if (settled || childExitInfo === null) {
      return;
    }
    // Last-resort guard: if the event loop is draining and the child has
    // already exited (but 'close' never fired, e.g. inherited stdio with
    // a dead terminal), exit now rather than hanging forever.
    settle(exitCodeFromChild(childExitInfo.code, childExitInfo.signal));
  };

  const checkOrphaned = (): void => {
    if (settled || childExitInfo === null) {
      return;
    }
    // If the shim has been reparented to init (ppid === 1) and the child
    // has already exited, the terminal is gone and no signal will arrive.
    // Force exit to avoid becoming an immortal husk.
    let orphaned: boolean;
    try {
      orphaned = getPpid() === 1;
    } catch {
      return;
    }
    if (orphaned) {
      settle(exitCodeFromChild(childExitInfo.code, childExitInfo.signal));
    }
  };

  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, forwardSignal);
  }
  child.on('error', onError);
  child.on('close', onClose);
  child.on('exit', onChildExit);
  process.on('beforeExit', onBeforeExit);
  orphanCheckTimer = setInterval(checkOrphaned, orphanCheckIntervalMs);
  orphanCheckTimer.unref();
}

module.exports = { runCliBin };

if (Object.is(module, require.main)) {
  runCliBin().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
