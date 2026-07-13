/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { env } from 'node:process';
import type { Writable } from 'node:stream';
import {
  detectQuotaSignal,
  formatQuotaError,
  getQuotaGuardTrip,
  isQuotaGuardActive,
  tripQuotaGuard,
} from './quota-guard.js';

/**
 * Stream handler that accumulates stdout/stderr and mirrors them to the
 * terminal when verbose output is enabled.
 */
interface StreamAccumulator {
  stdout: string;
  stderr: string;
}

function createStreamHandlers(): {
  onStdout: (data: Buffer) => void;
  onStderr: (data: Buffer) => void;
  accumulator: StreamAccumulator;
} {
  const accumulator: StreamAccumulator = { stdout: '', stderr: '' };
  return {
    accumulator,
    onStdout(data: Buffer) {
      accumulator.stdout += data;
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stdout.write(data);
      }
    },
    onStderr(data: Buffer) {
      accumulator.stderr += data;
      if (env['KEEP_OUTPUT'] === 'true' || env['VERBOSE'] === 'true') {
        process.stderr.write(data);
      }
    },
  };
}

export interface RunOptions {
  args?: string | string[];
  stdin?: string;
  stdinDoesNotEnd?: boolean;
  yolo?: boolean;
}

export interface RunContext {
  command: string;
  commandArgs: string[];
  testDir: string;
  childEnv?: NodeJS.ProcessEnv;
}

/**
 * Whether this run uses fake responses (and therefore must NOT be observed by
 * the quota guard).
 *
 * Runs backed by fake responses never touch a real provider, so quota/
 * rate-limit detection is meaningless for them and could produce false trips
 * from fixture text. Applicability is read from the child environment when the
 * caller supplies one, otherwise from `process.env` (the child inherits it).
 */
function usesFakeResponses(ctx: RunContext): boolean {
  const fakeResponses =
    ctx.childEnv !== undefined
      ? ctx.childEnv['LLXPRT_FAKE_RESPONSES']
      : process.env['LLXPRT_FAKE_RESPONSES'];
  return fakeResponses !== undefined && fakeResponses !== '';
}

/**
 * Whether the E2E quota guard should observe this run.
 *
 * Two independent conditions must both hold:
 *   1. The run is NOT fake-response-backed (see {@link usesFakeResponses}).
 *   2. The shared guard is globally active ({@link isQuotaGuardActive}) — i.e.
 *      a sentinel state dir is configured and `LLXPRT_QUOTA_GUARD_DISABLED` is
 *      not `true`.
 *
 * Folding the global predicate in here means that with the guard disabled,
 * `tripQuotaGuard` (which no-ops) is never even reached and, crucially, the
 * failure-classification paths keep the ORIGINAL exit/timeout error instead of
 * relabelling it `[QUOTA/RATE-LIMIT]`. Reusing the guard's own predicate keeps
 * this in lockstep with the sentinel rather than re-deriving disabled-state.
 */
function guardApplies(ctx: RunContext): boolean {
  return !usesFakeResponses(ctx) && isQuotaGuardActive();
}

/**
 * Pre-spawn short-circuit: once the guard has tripped, refuse to launch any
 * further real-provider CLI runs. Returns the rejection error, or `null` when
 * the run may proceed.
 */
function preSpawnGuardError(ctx: RunContext): Error | null {
  if (!guardApplies(ctx)) {
    return null;
  }
  const trip = getQuotaGuardTrip();
  if (trip === null) {
    return null;
  }
  return new Error(
    `E2E quota guard tripped — refusing to start CLI run: ${trip.reason}`,
  );
}

/**
 * Scan accumulated child output for a quota/rate-limit signal, tripping the
 * guard on the first match. Returns the reason when a signal is present and
 * the guard applies, otherwise `null`.
 */
function detectAndTripQuota(
  ctx: RunContext,
  accumulator: StreamAccumulator,
): string | null {
  if (!guardApplies(ctx)) {
    return null;
  }
  const reason = detectQuotaSignal(
    `${accumulator.stdout}\n${accumulator.stderr}`,
  );
  if (reason === null) {
    return null;
  }
  tripQuotaGuard(reason);
  return reason;
}

/**
 * Build the rejection error for a non-zero exit, upgrading it to a labelled
 * quota error (and tripping the guard) when the output looks like a provider
 * quota/rate-limit wall.
 *
 * Node's `close` event reports EITHER a numeric exit `code` (with `signal`
 * `null`) or a `signal` name (with `code` `null`) when the child was terminated
 * by a signal. The message distinguishes the two so a signal-killed child reads
 * as "terminated by signal SIGTERM" rather than a misleading
 * "exited with code null".
 */
function buildExitFailureError(
  ctx: RunContext,
  code: number | null,
  signal: NodeJS.Signals | null,
  accumulator: StreamAccumulator,
): Error {
  const detail =
    code !== null
      ? `Process exited with code ${code}`
      : `Process terminated by signal ${signal ?? 'unknown'}`;
  const baseMessage = `${detail}:\n${accumulator.stderr}`;
  const reason = detectAndTripQuota(ctx, accumulator);
  if (reason !== null) {
    return new Error(formatQuotaError(reason, baseMessage));
  }
  return new Error(baseMessage);
}

/**
 * Build the rejection error for a timed-out run, upgrading it to a labelled
 * quota error (and tripping the guard) when the accumulated output looks like
 * a provider quota/rate-limit wall.
 */
function buildTimeoutError(
  ctx: RunContext,
  timeoutMs: number,
  accumulator: StreamAccumulator,
): Error {
  const reason = detectAndTripQuota(ctx, accumulator);
  if (reason !== null) {
    return new Error(
      formatQuotaError(reason, `TestRig.run() timed out after ${timeoutMs}ms`),
    );
  }
  return new Error(`TestRig.run() timed out after ${timeoutMs}ms`);
}

/**
 * Spawn a child process for `TestRig.run` / `runCommand` and resolve with the
 * captured stdout. Mirrors output when verbose mode is enabled.
 */
export function spawnRun(
  ctx: RunContext,
  options: RunOptions,
  isJsonOutput: boolean,
  transform: (stdout: string) => string,
): Promise<string> {
  const preSpawnError = preSpawnGuardError(ctx);
  if (preSpawnError !== null) {
    return Promise.reject(preSpawnError);
  }

  const { onStdout, onStderr, accumulator } = createStreamHandlers();

  const child = spawn(ctx.command, ctx.commandArgs, {
    cwd: ctx.testDir,
    stdio: 'pipe',
    env: ctx.childEnv,
  });

  pipeStdin(child, options);

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  return new Promise<string>((resolve, reject) => {
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0) {
        const transformed = transform(accumulator.stdout);
        resolve(
          maybeAppendStderr(transformed, accumulator.stderr, isJsonOutput),
        );
      } else {
        reject(buildExitFailureError(ctx, code, signal, accumulator));
      }
    });
  });
}

/**
 * Spawn a child process with a timeout for `TestRig.run`.
 */
export function spawnRunWithTimeout(
  ctx: RunContext,
  options: RunOptions,
  isJsonOutput: boolean,
  transform: (stdout: string) => string,
  timeoutMs: number,
): Promise<string> {
  const preSpawnError = preSpawnGuardError(ctx);
  if (preSpawnError !== null) {
    return Promise.reject(preSpawnError);
  }

  const { onStdout, onStderr, accumulator } = createStreamHandlers();

  const child = spawn(ctx.command, ctx.commandArgs, {
    cwd: ctx.testDir,
    stdio: 'pipe',
    env: ctx.childEnv,
  });

  pipeStdin(child, options);

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  // Ensures exactly one of the close/timeout paths settles the race. Without
  // this, a timed-out child still emits a late 'close' event that would re-run
  // quota detection (a redundant, and in tests cross-boundary, side effect).
  let settled = false;
  let timeoutHandle: NodeJS.Timeout;
  const processPromise = new Promise<string>((resolve, reject) => {
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      if (code === 0) {
        const transformed = transform(accumulator.stdout);
        resolve(
          maybeAppendStderr(transformed, accumulator.stderr, isJsonOutput),
        );
      } else {
        reject(buildExitFailureError(ctx, code, signal, accumulator));
      }
    });
  });

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill('SIGTERM');
      reject(buildTimeoutError(ctx, timeoutMs, accumulator));
    }, timeoutMs);
  });

  return Promise.race([processPromise, timeoutPromise]);
}

function maybeAppendStderr(
  result: string,
  stderr: string,
  isJsonOutput: boolean,
): string {
  if (stderr.length > 0 && !isJsonOutput) {
    return `${result}\n\nStdErr:\n${stderr}`;
  }
  return result;
}

/**
 * Write stdin to a child process and close the stream unless the caller opted
 * to keep it open (`stdinDoesNotEnd`).
 */
function pipeStdin(child: ReturnType<typeof spawn>, options: RunOptions): void {
  const stdin = getWritable(child.stdin);
  if (options.stdin !== undefined) {
    stdin.write(options.stdin);
  }
  if (options.stdinDoesNotEnd !== true) {
    stdin.end();
  }
}

/**
 * Return a guaranteed-non-null writable stream. Used with `stdio: 'pipe'`
 * spawns, which always allocate a stdin stream.
 */
function getWritable(stream: Writable | null): Writable {
  if (stream === null) {
    throw new Error('Expected spawn stdio stream but received null');
  }
  return stream;
}
