/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { env } from 'node:process';
import type { Writable } from 'node:stream';

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
 * captured stdout. Mirrors output when verbose mode is enabled.
 */
export function spawnRun(
  ctx: RunContext,
  options: RunOptions,
  isJsonOutput: boolean,
  transform: (stdout: string) => string,
): Promise<string> {
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
    child.on('close', (code: number) => {
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
  const { onStdout, onStderr, accumulator } = createStreamHandlers();

  const child = spawn(ctx.command, ctx.commandArgs, {
    cwd: ctx.testDir,
    stdio: 'pipe',
    env: ctx.childEnv,
  });

  pipeStdin(child, options);

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);

  let timeoutHandle: NodeJS.Timeout;
  const processPromise = new Promise<string>((resolve, reject) => {
    child.on('close', (code: number) => {
      clearTimeout(timeoutHandle);
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
  });

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`TestRig.run() timed out after ${timeoutMs}ms`));
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
