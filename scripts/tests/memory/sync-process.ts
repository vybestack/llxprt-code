/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { constants } from 'node:os';
import { join } from 'node:path';

export interface CapturedProcessResult {
  /** Null when the process was terminated by a signal or timed out. */
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  /** Spawn failure or timeout reported by the nested process. */
  readonly error?: Error;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CaptureProcessOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeout?: number;
}

const captureChildOutput = [
  'const { closeSync, openSync, writeFileSync } = require("node:fs");',
  'const { spawnSync } = require("node:child_process");',
  'const [stdoutPath, stderrPath, resultPath, timeoutRaw, command, ...args] = process.argv.slice(1);',
  'const timeout = timeoutRaw === "" ? undefined : Number(timeoutRaw);',
  'const stdoutFd = openSync(stdoutPath, "w");',
  'const stderrFd = openSync(stderrPath, "w");',
  'try {',
  '  const result = spawnSync(command, args, { stdio: ["ignore", stdoutFd, stderrFd], timeout });',
  '  writeFileSync(resultPath, JSON.stringify({',
  '    status: result.status,',
  '    signal: result.signal,',
  '    error: result.error === undefined ? null : result.error.message,',
  '  }));',
  '} finally {',
  '  closeSync(stdoutFd);',
  '  closeSync(stderrFd);',
  '}',
].join('\n');

interface NestedProcessOutcome {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error: string | null;
}

function isSignal(value: unknown): value is NodeJS.Signals {
  return typeof value === 'string' && value in constants.signals;
}

function readNestedOutcome(resultPath: string): NestedProcessOutcome {
  const parsed: unknown = JSON.parse(readFileSync(resultPath, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Nested process outcome is not an object');
  }
  const { status, signal, error } = {
    status: 'status' in parsed ? parsed.status : undefined,
    signal: 'signal' in parsed ? parsed.signal : undefined,
    error: 'error' in parsed ? parsed.error : undefined,
  };
  if (status !== null && typeof status !== 'number') {
    throw new Error('Nested process outcome has an invalid status');
  }
  if (signal !== null && !isSignal(signal)) {
    throw new Error('Nested process outcome has an invalid signal');
  }
  if (error !== null && typeof error !== 'string') {
    throw new Error('Nested process outcome has an invalid error');
  }
  return { status, signal, error };
}

/**
 * Runs a real process synchronously and captures its output without forwarding
 * Bun test-runner pipe descriptors to nested Bun processes.
 *
 * @param captureRoot Directory in which temporary capture files may be created.
 * @param command Executable to run.
 * @param args Arguments passed to the executable.
 * @param options Working directory, environment, and optional timeout.
 * @returns The child status and decoded standard streams.
 */
export function spawnSyncWithFileCapture(
  captureRoot: string,
  command: string,
  args: readonly string[],
  options: CaptureProcessOptions,
): CapturedProcessResult {
  mkdirSync(captureRoot, { recursive: true });
  const captureDir = mkdtempSync(join(captureRoot, 'sync-capture-'));
  const stdoutPath = join(captureDir, 'stdout.log');
  const stderrPath = join(captureDir, 'stderr.log');
  const resultPath = join(captureDir, 'result.json');
  const stdoutFd = openSync(stdoutPath, 'w');
  const stderrFd = openSync(stderrPath, 'w');
  closeSync(stdoutFd);
  closeSync(stderrFd);

  try {
    const wrapper = spawnSync(
      'node',
      [
        '-e',
        captureChildOutput,
        stdoutPath,
        stderrPath,
        resultPath,
        options.timeout === undefined ? '' : String(options.timeout),
        command,
        ...args,
      ],
      {
        cwd: options.cwd,
        env: options.env,
        // Let the wrapper publish the child's timeout result before the outer
        // process guard terminates a wrapper that failed to exit.
        timeout:
          options.timeout === undefined ? undefined : options.timeout + 1_000,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    if (wrapper.error !== undefined) {
      throw wrapper.error;
    }
    // The wrapper publishes the nested outcome before a clean exit; anything
    // else means the capture itself failed, not the process under test.
    if (wrapper.status !== 0) {
      throw new Error(
        `Output capture wrapper failed (status=${String(wrapper.status)}, signal=${String(wrapper.signal)}) for ${command}`,
      );
    }
    const outcome = readNestedOutcome(resultPath);
    return {
      status: outcome.status,
      signal: outcome.signal,
      ...(outcome.error === null ? {} : { error: new Error(outcome.error) }),
      stdout: readFileSync(stdoutPath, 'utf8'),
      stderr: readFileSync(stderrPath, 'utf8'),
    };
  } finally {
    rmSync(captureDir, { recursive: true, force: true });
  }
}
