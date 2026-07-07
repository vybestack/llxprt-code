/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { basename } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { FatalError } from '@vybestack/llxprt-code-core';
import { resolveBunPath } from './bun-path-resolver.js';
import { resolveBunEntry } from './bun-entry-resolver.js';

const BUN_RELAUNCH_ENV = 'LLXPRT_BUN_RELAUNCHED';

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

function createSpawnOptions(
  bunPath: string,
  platform: string,
  childEnv: NodeJS.ProcessEnv,
): { stdio: 'inherit'; env: NodeJS.ProcessEnv; shell?: boolean } {
  const spawnOptions: {
    stdio: 'inherit';
    env: NodeJS.ProcessEnv;
    shell?: boolean;
  } = { stdio: 'inherit', env: childEnv };
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

function waitForChildExit(
  child: ChildProcess,
  bunPath: string,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let settled = false;
    const forwardSignal = (signal: NodeJS.Signals): void => {
      // child.killed only means a signal was sent, not that the child exited;
      // gate on the launcher's settled state so signals forward until exit.
      if (!settled) {
        child.kill(signal);
      }
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
  } catch (spawnError) {
    if (spawnError instanceof FatalError) {
      throw spawnError;
    }
    throw toSpawnFatalError(spawnError, bunPath);
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
