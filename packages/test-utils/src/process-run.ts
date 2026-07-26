/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
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
 * Structured capture of the most recent process run, available for diagnosis
 * after `spawnRun` / `spawnRunWithTimeout` resolve or reject. Contains the raw
 * (untransformed) child stdout and stderr so callers can inspect the original
 * process output regardless of the transform applied to the resolved value.
 */
export interface RunCapture {
  /** Raw stdout accumulated from the child process (before transform). */
  readonly stdout: string;
  /** Raw stderr accumulated from the child process. */
  readonly stderr: string;
  /** The process exit code, or null when the process was killed/timed out. */
  readonly exitCode: number | null;
  /** Whether the process timed out. */
  readonly timedOut: boolean;
}

export type RunCaptureHandler = (capture: RunCapture) => void;

interface CaptureFailure {
  readonly error: unknown;
}

const TERMINATION_GRACE_MS = 500;
const FORCE_KILL_CLOSE_GRACE_MS = 500;

function signalProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      // Timeout-managed children are spawned detached below, which makes the
      // child PID the process-group ID on POSIX systems.
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The child may have exited between the timeout and the signal.
    }
  }

  // Windows has no POSIX-style graceful process-tree signal. The timeout path
  // therefore waits through the grace period before taskkill force-terminates
  // the tree; child.kill('SIGTERM') only targets the immediate process there.
  if (
    process.platform === 'win32' &&
    signal === 'SIGKILL' &&
    child.pid !== undefined
  ) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', () => {
      try {
        child.kill(signal);
      } catch {
        // The main child may already have exited while taskkill was starting.
      }
    });
    killer.unref();
    return;
  }

  try {
    child.kill(signal);
  } catch {
    // The child may have exited between the timeout and the fallback signal.
  }
}

function captureRun(
  accumulator: StreamAccumulator,
  exitCode: number | null,
  timedOut: boolean,
  onCapture: RunCaptureHandler | undefined,
): CaptureFailure | null {
  try {
    onCapture?.({
      stdout: accumulator.stdout,
      stderr: accumulator.stderr,
      exitCode,
      timedOut,
    });
    return null;
  } catch (error) {
    return { error };
  }
}

function captureErrorOr(
  failure: CaptureFailure | null,
  fallback: unknown,
): unknown {
  if (failure === null) {
    return fallback;
  }
  const aggregate = new AggregateError(
    [fallback, failure.error],
    'Process run and capture handler both failed',
  );
  Object.defineProperty(aggregate, 'cause', { value: fallback });
  return aggregate;
}

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
 * captured stdout. Mirrors output when verbose mode is enabled and reports the
 * structured raw capture before resolving or rejecting.
 */
export function spawnRun(
  ctx: RunContext,
  options: RunOptions,
  isJsonOutput: boolean,
  transform: (stdout: string) => string,
  onCapture?: RunCaptureHandler,
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

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    child.once('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(
        captureErrorOr(captureRun(accumulator, null, false, onCapture), error),
      );
    });

    child.once(
      'close',
      (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) {
          return;
        }
        settled = true;
        const captureFailure = captureRun(accumulator, code, false, onCapture);
        if (captureFailure !== null) {
          const processError =
            code === 0
              ? null
              : buildExitFailureError(ctx, code, signal, accumulator);
          reject(
            processError === null
              ? captureFailure.error
              : captureErrorOr(captureFailure, processError),
          );
          return;
        }

        if (code === 0) {
          const transformed = transform(accumulator.stdout);
          resolve(
            maybeAppendStderr(transformed, accumulator.stderr, isJsonOutput),
          );
        } else {
          reject(buildExitFailureError(ctx, code, signal, accumulator));
        }
      },
    );

    pipeStdin(child, options);
  });
}

interface CloseRunContext {
  readonly ctx: RunContext;
  readonly accumulator: StreamAccumulator;
  readonly onCapture: RunCaptureHandler | undefined;
  readonly transform: (stdout: string) => string;
  readonly isJsonOutput: boolean;
  readonly timeoutMs: number;
  readonly resolve: (value: string) => void;
  readonly reject: (reason?: unknown) => void;
}

function settleClosedRun(
  context: CloseRunContext,
  code: number | null,
  signal: NodeJS.Signals | null,
  didTimeout: boolean,
): void {
  const captureFailure = captureRun(
    context.accumulator,
    code,
    didTimeout,
    context.onCapture,
  );
  let processError: Error | null = null;
  if (didTimeout) {
    processError = buildTimeoutError(
      context.ctx,
      context.timeoutMs,
      context.accumulator,
    );
  } else if (code !== 0) {
    processError = buildExitFailureError(
      context.ctx,
      code,
      signal,
      context.accumulator,
    );
  }
  if (captureFailure !== null) {
    context.reject(
      processError === null
        ? captureFailure.error
        : captureErrorOr(captureFailure, processError),
    );
    return;
  }
  if (processError !== null) {
    context.reject(processError);
    return;
  }
  const transformed = context.transform(context.accumulator.stdout);
  context.resolve(
    maybeAppendStderr(
      transformed,
      context.accumulator.stderr,
      context.isJsonOutput,
    ),
  );
}

function clearRunTimers(timers: NodeJS.Timeout[]): void {
  for (const timer of timers) {
    clearTimeout(timer);
  }
}

/** Spawn a run with bounded SIGTERM/SIGKILL timeout handling. */
export function spawnRunWithTimeout(
  ctx: RunContext,
  options: RunOptions,
  isJsonOutput: boolean,
  transform: (stdout: string) => string,
  timeoutMs: number,
  onCapture?: RunCaptureHandler,
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
    detached: process.platform !== 'win32',
  });

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  return new Promise<string>((resolve, reject) => {
    runTimeoutLifecycle(
      child,
      ctx,
      options,
      timeoutMs,
      accumulator,
      onCapture,
      transform,
      isJsonOutput,
      resolve,
      reject,
    );
  });
}

/**
 * Manage the timeout/error/close lifecycle for a {@link spawnRunWithTimeout}
 * child. Extracted to keep {@link spawnRunWithTimeout} within lint line limits.
 */
function runTimeoutLifecycle(
  child: ChildProcess,
  ctx: RunContext,
  options: RunOptions,
  timeoutMs: number,
  accumulator: StreamAccumulator,
  onCapture: RunCaptureHandler | undefined,
  transform: (stdout: string) => string,
  isJsonOutput: boolean,
  resolve: (value: string) => void,
  reject: (reason?: unknown) => void,
): void {
  let settled = false;
  let didTimeout = false;
  const timers: NodeJS.Timeout[] = [];
  const settleTimedOut = (): void => {
    if (!settled) {
      settled = true;
      reject(
        captureErrorOr(
          captureRun(accumulator, null, true, onCapture),
          buildTimeoutError(ctx, timeoutMs, accumulator),
        ),
      );
    }
  };
  const forceKill = (): void => {
    signalProcess(child, 'SIGKILL');
    timers.push(setTimeout(settleTimedOut, FORCE_KILL_CLOSE_GRACE_MS));
  };
  timers.push(
    setTimeout(() => {
      didTimeout = true;
      signalProcess(child, 'SIGTERM');
      timers.push(setTimeout(forceKill, TERMINATION_GRACE_MS));
    }, timeoutMs),
  );
  child.once('error', (error) => {
    if (!settled) {
      settled = true;
      if (!didTimeout) {
        clearRunTimers(timers);
      }
      reject(
        childErrorOrQuota(
          ctx,
          timeoutMs,
          error,
          didTimeout,
          accumulator,
          onCapture,
        ),
      );
    }
  });

  const closeContext: CloseRunContext = {
    ctx,
    accumulator,
    onCapture,
    transform,
    isJsonOutput,
    timeoutMs,
    resolve,
    reject,
  };
  child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
    if (!settled) {
      settled = true;
      clearRunTimers(timers);
      settleClosedRun(closeContext, code, signal, didTimeout);
    }
  });

  pipeStdin(child, options);
}

/**
 * Build the rejection value for a child 'error' event, upgrading it to a
 * labelled quota timeout error when the error arrives after the timeout fired.
 * Extracted from {@link runTimeoutLifecycle} to keep it within lint limits.
 */
function childErrorOrQuota(
  ctx: RunContext,
  timeoutMs: number,
  error: Error,
  didTimeout: boolean,
  accumulator: StreamAccumulator,
  onCapture: RunCaptureHandler | undefined,
): unknown {
  const runError = didTimeout
    ? buildTimeoutError(ctx, timeoutMs, accumulator)
    : error;
  return captureErrorOr(
    captureRun(accumulator, null, didTimeout, onCapture),
    runError,
  );
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
