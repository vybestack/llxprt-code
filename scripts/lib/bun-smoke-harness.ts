/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Timeout-only retry policy for the Bun native-module smoke harness.
 *
 * Issue #3447 applies the issue #3439 policy at the harness subprocess boundary:
 * a timed-out child gets one fresh attempt by default, while deterministic
 * failures are reported immediately and are never retried.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_SMOKE_TIMEOUT_RETRIES = 1;
const SMOKE_TIMEOUT_RETRIES_ENV_VAR = 'LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES';
// Bun rejects --timeout above 2^32-1. This shared #3447 budget reaches that
// runner flag, so fail here with a diagnostic naming both knobs.
const MAX_BUN_TEST_TIMEOUT_MS = 4_294_967_295;
export const SMOKE_TEST_FILE_TIMEOUT_PAD_MS = 10_000;
const BUN_INSTALL_HINT =
  'Bun is required to run the native-module smoke harness; install the version pinned in .bun-version and ensure bun is on PATH.';

export interface SmokeHarnessCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface SmokeHarnessAttemptOptions {
  readonly cwd: string;
  readonly timeoutMs: number;
}

export type SmokeHarnessAttemptOutcome =
  | { readonly kind: 'passed'; readonly stdout: string }
  | {
      readonly kind: 'timeout';
      readonly diagnostics: string;
      readonly cause: unknown;
    }
  | { readonly kind: 'enoent'; readonly cause: unknown }
  | {
      readonly kind: 'exit';
      readonly code: number;
      readonly diagnostics: string;
      readonly cause: unknown;
    }
  | {
      readonly kind: 'exec-error';
      readonly message: string;
      readonly diagnostics: string;
      readonly cause: unknown;
    };

export interface SmokeHarnessRunOptions extends SmokeHarnessAttemptOptions {
  readonly retries: number;
}

export interface SmokeHarnessRunResult {
  readonly stdout: string;
  readonly attempts: number;
}

export class SmokeHarnessRunError extends Error {
  readonly attempts: number;

  constructor(message: string, attempts: number, cause: unknown) {
    super(message, { cause });
    this.name = 'SmokeHarnessRunError';
    this.attempts = attempts;
  }
}

export function resolveHarnessTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const DEFAULT = 300_000;
  const raw = env.LLXPRT_BUN_SMOKE_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT;
  return Math.floor(parsed);
}

/** Resolves the timeout-only retry budget; 0 restores one attempt. */
export function resolveSmokeTimeoutRetries(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[SMOKE_TIMEOUT_RETRIES_ENV_VAR];
  if (raw === undefined || raw === '') {
    return DEFAULT_SMOKE_TIMEOUT_RETRIES;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${SMOKE_TIMEOUT_RETRIES_ENV_VAR} value: ${raw} (expected a non-negative integer)`,
    );
  }
  return parsed;
}

/**
 * The scripts runner's per-file kill budget is max(120_000, 2 × registry
 * timeout). Deriving the registry override and test timeout here keeps that
 * kill budget strictly above the test timeout for every #3447 knob combination.
 */
export function smokeTestFileTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const total =
    (resolveSmokeTimeoutRetries(env) + 1) *
    (resolveHarnessTimeoutMs(env) + SMOKE_TEST_FILE_TIMEOUT_PAD_MS);
  if (!Number.isFinite(total) || total > MAX_BUN_TEST_TIMEOUT_MS) {
    throw new Error(
      `Computed smoke test file timeout ${total}ms exceeds the Bun --timeout maximum ${MAX_BUN_TEST_TIMEOUT_MS}ms; lower LLXPRT_BUN_SMOKE_TIMEOUT_MS or LLXPRT_BUN_SMOKE_TIMEOUT_RETRIES.`,
    );
  }
  return total;
}

function errorProperty(error: object, property: string): unknown {
  return Reflect.get(error, property);
}

function collectProcessDiagnostics(error: object): string {
  return [errorProperty(error, 'stdout'), errorProperty(error, 'stderr')]
    .filter(
      (output): output is string =>
        typeof output === 'string' && output.trim().length > 0,
    )
    .join('\n')
    .trim();
}

function classifyExecutionError(error: unknown): SmokeHarnessAttemptOutcome {
  if (typeof error !== 'object' || error === null) {
    return {
      kind: 'exec-error',
      message: String(error),
      diagnostics: '',
      cause: error,
    };
  }

  const code = errorProperty(error, 'code');
  if (code === 'ENOENT') {
    return { kind: 'enoent', cause: error };
  }

  const diagnostics = collectProcessDiagnostics(error);
  if (code === 'ABORT_ERR' && errorProperty(error, 'name') === 'AbortError') {
    return { kind: 'timeout', diagnostics, cause: error };
  }
  if (typeof code === 'number') {
    return { kind: 'exit', code, diagnostics, cause: error };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  return {
    kind: 'exec-error',
    message: rawMessage.trim() || `system error ${String(code)}`,
    diagnostics,
    cause: error,
  };
}

/** Runs one bounded harness subprocess and classifies its observable outcome. */
export async function runSmokeHarnessAttempt(
  command: SmokeHarnessCommand,
  options: SmokeHarnessAttemptOptions,
): Promise<SmokeHarnessAttemptOutcome> {
  try {
    const { stdout } = await execFileAsync(
      command.executable,
      [...command.args],
      {
        cwd: options.cwd,
        encoding: 'utf8',
        env: command.env === undefined ? process.env : { ...command.env },
        signal: AbortSignal.timeout(options.timeoutMs),
      },
    );
    return { kind: 'passed', stdout };
  } catch (error: unknown) {
    return classifyExecutionError(error);
  }
}

function formatFailure(
  outcome: Exclude<SmokeHarnessAttemptOutcome, { kind: 'passed' | 'timeout' }>,
): string {
  if (outcome.kind === 'enoent') {
    return BUN_INSTALL_HINT;
  }
  if (outcome.kind === 'exit') {
    return `Bun native-module smoke harness failed with exit code ${outcome.code}${outcome.diagnostics ? `:\n${outcome.diagnostics}` : '.'}`;
  }
  return `Bun native-module smoke harness could not execute: ${outcome.message}${outcome.diagnostics ? `\n${outcome.diagnostics}` : ''}`;
}

function formatTimeoutFailure(
  timeoutMs: number,
  diagnostics: readonly string[],
): string {
  const attempts = diagnostics.length;
  const attemptWord = attempts === 1 ? 'attempt' : 'attempts';
  const output = diagnostics
    .map(
      (diagnostic, index) =>
        `Attempt ${index + 1}:\n${diagnostic || '(no output captured)'}`,
    )
    .join('\n');
  return `Bun native-module smoke harness exceeded its ${timeoutMs}ms subprocess timeout after ${attempts} ${attemptWord}:\n${output}`;
}

function throwFailure(
  outcome: Exclude<SmokeHarnessAttemptOutcome, { kind: 'passed' | 'timeout' }>,
  attempts: number,
): never {
  throw new SmokeHarnessRunError(
    formatFailure(outcome),
    attempts,
    outcome.cause,
  );
}

/** Retries only timed-out attempts and returns the successful attempt count. */
export async function runSmokeHarnessWithTimeoutRetry(
  command: SmokeHarnessCommand,
  options: SmokeHarnessRunOptions,
): Promise<SmokeHarnessRunResult> {
  let attempts = 0;
  let retriesLeft = options.retries;
  let timeoutDiagnostics: readonly string[] = [];

  while (true) {
    attempts += 1;
    const outcome = await runSmokeHarnessAttempt(command, options);
    if (outcome.kind === 'passed') {
      return { stdout: outcome.stdout, attempts };
    }
    if (outcome.kind !== 'timeout') {
      throwFailure(outcome, attempts);
    }

    timeoutDiagnostics = [...timeoutDiagnostics, outcome.diagnostics];
    if (retriesLeft === 0) {
      throw new SmokeHarnessRunError(
        formatTimeoutFailure(options.timeoutMs, timeoutDiagnostics),
        attempts,
        outcome.cause,
      );
    }
    retriesLeft -= 1;
  }
}
