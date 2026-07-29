/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { basename } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { FatalError } from '@vybestack/llxprt-code-core';
import { resolveBunPath } from './bun-path-resolver.js';
import { resolveBunEntry } from './bun-entry-resolver.js';

const BUN_RELAUNCH_ENV = 'LLXPRT_BUN_RELAUNCHED';
const CAPABILITY_FD_ENV = 'LLXPRT_CAPABILITY_FD';

/**
 * Closes the inherited capability descriptor (fd 3) in THIS process after it
 * has been inherited by the spawned child. Swallows only EBADF (already
 * closed); other close failures surface.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC3)
 */
function closeInheritedCapabilityFd(): void {
  const marker = process.env[CAPABILITY_FD_ENV];
  if (marker === undefined || marker === '') return;
  const fd = Number(marker);
  if (!Number.isInteger(fd) || fd < 0) return;
  try {
    fs.closeSync(fd);
  } catch (err) {
    // EBADF: already closed (safe idempotent state); must not abort relaunch.
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as NodeJS.ErrnoException).code !== 'EBADF'
    ) {
      throw err;
    }
  }
}

/**
 * Best-effort close of the inherited capability descriptor. Returns the close
 * error (if any, excluding EBADF) instead of throwing, so callers can
 * aggregate it with a primary failure.
 *
 * @plan project-plans/issue-1954-sandbox-hardening.md (AC3, O5)
 */
function tryCloseInheritedCapabilityFd(): unknown {
  const marker = process.env[CAPABILITY_FD_ENV];
  if (marker === undefined || marker === '') return undefined;
  const fd = Number(marker);
  if (!Number.isInteger(fd) || fd < 0) return undefined;
  try {
    fs.closeSync(fd);
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === 'EBADF'
    ) {
      return undefined;
    }
    return err;
  }
  return undefined;
}

export type ExitFn = (code?: number) => never;

export interface LauncherOutcome {
  readonly relaunched: boolean;
  readonly exitCode?: number;
}

export interface RelaunchOptions {
  readonly isRunningUnderBun?: () => boolean;
  readonly envGuardSet?: () => boolean;
  readonly resolveBun?: () => Promise<string | null>;
  readonly resolveEntry?: () => Promise<string | null>;
  readonly spawn?: typeof spawn;
  readonly platform?: string;
}

export interface RunLauncherOptions extends RelaunchOptions {
  readonly exit?: ExitFn;
}

function isRunningUnderBunDefault(): boolean {
  return (
    typeof process.versions.bun === 'string' && process.versions.bun.length > 0
  );
}

function envGuardSetDefault(): boolean {
  return process.env[BUN_RELAUNCH_ENV] === 'true';
}

/**
 * npm shims on Windows produce `bun.cmd` wrappers that cannot be executed
 * directly by child_process.spawn without a shell. Detecting these lets the
 * spawn layer opt into shell mode only for the unsafe case.
 */
function isWindowsCmdShim(bunPath: string, platform: string): boolean {
  return platform === 'win32' && basename(bunPath).toLowerCase() === 'bun.cmd';
}

/**
 * Converts a spawn failure (synchronous throw or asynchronous 'error' event)
 * into a FatalError so the caller prints an actionable message instead of an
 * unhandled stack trace or a hung promise.
 */
function toSpawnFatalError(error: unknown, bunPath: string): FatalError {
  const detail = error instanceof Error ? error.message : String(error);
  return new FatalError(
    `Failed to launch Bun at "${bunPath}" (${detail}). Reinstall dependencies with "npm install" to restore the bundled Bun, or ensure a working Bun is executable and on your PATH (see https://bun.sh).`,
    43,
  );
}

async function resolveRequiredBunPath(
  resolveBun: () => Promise<string | null>,
): Promise<string> {
  const bunPath = await resolveBun();
  if (bunPath !== null) {
    return bunPath;
  }
  throw new FatalError(
    'Bun runtime was not found. Install it with "npm install" (it is bundled as the "bun" dependency) or install Bun directly from https://bun.sh and ensure it is on your PATH.',
    43,
  );
}

async function resolveRequiredEntry(
  resolveEntry: () => Promise<string | null>,
): Promise<string> {
  const entry = await resolveEntry();
  if (entry !== null) {
    return entry;
  }
  throw new FatalError(
    'Could not locate the LLxprt Code entry point (packages/cli/index.ts or dist/index.js). Your installation may be corrupt; reinstall @vybestack/llxprt-code.',
    43,
  );
}

function createChildEnv(): NodeJS.ProcessEnv {
  return { ...process.env, [BUN_RELAUNCH_ENV]: 'true' };
}

function resolveCapabilityFd(childEnv: NodeJS.ProcessEnv): number | undefined {
  const capabilityFdMarker = childEnv[CAPABILITY_FD_ENV];
  if (capabilityFdMarker === undefined) return undefined;
  const capabilityFd = Number(capabilityFdMarker);
  if (
    !Number.isInteger(capabilityFd) ||
    capabilityFd < 0 ||
    String(capabilityFd) !== capabilityFdMarker
  ) {
    throw new FatalError('Invalid LLXPRT_CAPABILITY_FD marker', 43);
  }
  return capabilityFd;
}

function createSpawnOptions(
  bunPath: string,
  platform: string,
  childEnv: NodeJS.ProcessEnv,
): {
  stdio: Array<'inherit' | number>;
  env: NodeJS.ProcessEnv;
  shell?: boolean;
} {
  const capabilityFd = resolveCapabilityFd(childEnv);
  const stdio: Array<'inherit' | number> =
    capabilityFd === undefined
      ? ['inherit', 'inherit', 'inherit']
      : ['inherit', 'inherit', 'inherit', capabilityFd];

  const spawnOptions: {
    stdio: Array<'inherit' | number>;
    env: NodeJS.ProcessEnv;
    shell?: boolean;
  } = { stdio, env: childEnv };
  if (isWindowsCmdShim(bunPath, platform)) {
    spawnOptions.shell = true;
  }
  return spawnOptions;
}

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGHUP: 129,
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

function exitCodeForClose(
  code: number | null,
  signal: NodeJS.Signals | null,
): number {
  if (code !== null) return code;
  if (signal !== null) return SIGNAL_EXIT_CODES[signal] ?? 1;
  return 1;
}

function hasWindowsCmdMetaCharacter(arg: string): boolean {
  return /[&|<>^()%!"\r\n]/.test(arg);
}

function resolveSpawnArgs(
  bunPath: string,
  platform: string,
  entry: string,
): string[] {
  const args = [entry, ...process.argv.slice(2)];
  if (
    isWindowsCmdShim(bunPath, platform) &&
    args.some(hasWindowsCmdMetaCharacter)
  ) {
    throw new FatalError(
      'Cannot safely forward arguments containing Windows command-shell metacharacters through the bundled bun.cmd shim. Install Bun directly so bun.exe is on PATH, or remove shell metacharacters from the CLI arguments.',
      43,
    );
  }
  return args;
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = [
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'SIGBREAK',
];

/**
 * Terminates a spawned child process (best-effort) so it is not orphaned when
 * the launcher must abort after a successful spawn (e.g. parent fd close
 * failure). Swallows kill errors — the caller already has a primary error.
 */
function killChild(child: ChildProcess): void {
  try {
    child.kill('SIGTERM');
  } catch {
    // best-effort
  }
}

function waitForChildExit(
  child: ChildProcess,
  bunPath: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const forwardSignal = (signal: NodeJS.Signals): void => {
      if (!settled) child.kill(signal);
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      child.off('close', onClose);
      child.off('error', onError);
      for (const signal of FORWARDED_SIGNALS) {
        process.off(signal, forwardSignal);
      }
      child.on('error', () => {
        // Swallow post-settle errors; the launcher outcome is already fixed.
      });
      callback();
    };
    const onClose = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => settle(() => resolve(exitCodeForClose(code, signal)));
    const onError = (error: Error): void => {
      const fatalError = toSpawnFatalError(error, bunPath);
      settle(() => reject(fatalError));
    };
    for (const signal of FORWARDED_SIGNALS) {
      process.on(signal, forwardSignal);
    }
    child.on('close', onClose);
    child.on('error', onError);
  });
}

export async function relaunchUnderBunIfNeeded(
  options: RelaunchOptions = {},
): Promise<LauncherOutcome> {
  const isRunningUnderBun =
    options.isRunningUnderBun ?? isRunningUnderBunDefault;
  const envGuardSet = options.envGuardSet ?? envGuardSetDefault;
  if (isRunningUnderBun() || envGuardSet()) return { relaunched: false };

  const resolveBun = options.resolveBun ?? (() => resolveBunPath());
  const resolveEntry = options.resolveEntry ?? (() => resolveBunEntry());
  const spawnFn = options.spawn ?? spawn;
  const platform = options.platform ?? process.platform;
  const bunPath = await resolveRequiredBunPath(resolveBun);
  const entry = await resolveRequiredEntry(resolveEntry);
  const childEnv = createChildEnv();

  let child: ChildProcess;
  try {
    const spawnOptions = createSpawnOptions(bunPath, platform, childEnv);
    const spawnArgs = resolveSpawnArgs(bunPath, platform, entry);
    child = spawnFn(bunPath, spawnArgs, spawnOptions);
    // AC3: Close the PARENT's fd 3 copy immediately after the child inherits
    // it, then delete the parent env marker so no later code can observe the
    // fd identity. If close fails after a successful spawn, terminate the
    // child so it is not orphaned and surface both errors.
    try {
      closeInheritedCapabilityFd();
    } catch (closeErr) {
      killChild(child);
      throw new AggregateError(
        [closeErr as Error],
        `Closing the inherited capability fd failed after a successful spawn: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`,
      );
    }
    delete process.env[CAPABILITY_FD_ENV];
  } catch (spawnError) {
    // O5: On synchronous spawn failures, close the fd and aggregate primary
    // + close errors. The parent env marker is deleted on every path.
    const closeError = tryCloseInheritedCapabilityFd();
    delete process.env[CAPABILITY_FD_ENV];
    if (spawnError instanceof FatalError) {
      if (closeError !== undefined) {
        throw new AggregateError(
          [spawnError, closeError as Error],
          `${spawnError.message}; additionally, closing the inherited capability fd failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
        );
      }
      throw spawnError;
    }
    const fatalError = toSpawnFatalError(spawnError, bunPath);
    if (closeError !== undefined) {
      throw new AggregateError(
        [fatalError, closeError as Error],
        `${fatalError.message}; additionally, closing the inherited capability fd failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
      );
    }
    throw fatalError;
  }

  const exitCode = await waitForChildExit(child, bunPath);
  return { relaunched: true, exitCode };
}

export async function runBunLauncherIfNeeded(
  options: RunLauncherOptions = {},
): Promise<void> {
  const outcome = await relaunchUnderBunIfNeeded(options);
  if (outcome.relaunched) {
    const exit = options.exit ?? process.exit;
    exit(outcome.exitCode);
  }
}
