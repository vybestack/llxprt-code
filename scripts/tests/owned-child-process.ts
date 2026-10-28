/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';

export interface OwnedChildOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Wall-clock limit for the child. The child is killed once it is exceeded. */
  readonly timeoutMs: number;
}

export interface OwnedChildResult {
  /** Exit code, or null when the child was ended by a signal. */
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

/**
 * Runs a child that this test owns end to end: both output pipes are drained
 * while it runs, and the result is reported only after the child has exited
 * and its pipes have closed. A synchronous spawn on Windows can fail to
 * return when the child's shutdown stalls; owning the child asynchronously
 * keeps the time limit enforceable and preserves what it printed.
 *
 * A child that outlives `timeoutMs` is killed and reported with
 * `timedOut: true` and whatever output it had produced, without waiting for
 * pipes that a stalled child may never close.
 */
export function runOwnedChild(
  command: string,
  args: readonly string[],
  options: OwnedChildOptions,
): Promise<OwnedChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({
        exitCode: child.exitCode,
        signal: child.signalCode,
        stdout,
        stderr,
        timedOut: true,
      });
    }, options.timeoutMs);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new Error(
          `${command} ${args.join(' ')} failed to spawn: ${error.message}`,
        ),
      );
    });
    // 'close' follows 'exit' and fires only once both pipes have ended.
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, signal, stdout, stderr, timedOut: false });
    });
  });
}

/** Renders a result for assertion messages so a stall can be diagnosed. */
export function describeOwnedChild(result: OwnedChildResult): string {
  return (
    `exitCode=${result.exitCode} signal=${result.signal} ` +
    `timedOut=${result.timedOut}\n` +
    `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
}
