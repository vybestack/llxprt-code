/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { env } from 'node:process';
import type { Writable } from 'node:stream';

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

const TERMINATION_GRACE_MS = 500;
const FORCE_KILL_CLOSE_GRACE_MS = 500;

function signalProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The child may have exited between the timeout and the signal.
    }
  }

  if (
    process.platform === 'win32' &&
    signal === 'SIGKILL' &&
    child.pid !== undefined
  ) {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', () => {});
    return;
  }

  child.kill(signal);
}

function createTimeoutError(timeoutMs: number): Error {
  return new Error(`TestRig.run() timed out after ${timeoutMs}ms`);
}

function captureRun(
  accumulator: StreamAccumulator,
  exitCode: number | null,
  timedOut: boolean,
  onCapture: RunCaptureHandler | undefined,
): void {
  onCapture?.({
    stdout: accumulator.stdout,
    stderr: accumulator.stderr,
    exitCode,
    timedOut,
  });
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
      captureRun(accumulator, null, false, onCapture);
      reject(error);
    });

    child.on('close', (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      captureRun(accumulator, code, false, onCapture);

      if (code === 0) {
        const transformed = transform(accumulator.stdout);
        resolve(
          maybeAppendStderr(transformed, accumulator.stderr, isJsonOutput),
        );
      } else {
        reject(
          new Error(`Process exited with code ${code}:\n${accumulator.stderr}`),
        );
      }
    });

    pipeStdin(child, options);
  });
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
    let settled = false;
    let didTimeout = false;
    const timers: NodeJS.Timeout[] = [];
    const timeoutError = createTimeoutError(timeoutMs);
    const settleTimedOut = (): void => {
      if (!settled) {
        settled = true;
        captureRun(accumulator, null, true, onCapture);
        reject(timeoutError);
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
    const clearTimers = (): void => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };

    child.once('error', (error) => {
      if (!settled) {
        settled = true;
        if (!didTimeout) {
          clearTimers();
        }
        captureRun(accumulator, null, didTimeout, onCapture);
        reject(didTimeout ? timeoutError : error);
      }
    });

    child.on('close', (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      captureRun(accumulator, code, didTimeout, onCapture);

      if (didTimeout) {
        reject(timeoutError);
        return;
      }

      if (code === 0) {
        const transformed = transform(accumulator.stdout);
        resolve(
          maybeAppendStderr(transformed, accumulator.stderr, isJsonOutput),
        );
      } else {
        reject(
          new Error(`Process exited with code ${code}:\n${accumulator.stderr}`),
        );
      }
    });

    pipeStdin(child, options);
  });
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
