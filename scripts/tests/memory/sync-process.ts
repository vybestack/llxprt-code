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
import { join } from 'node:path';

export interface CapturedProcessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CaptureProcessOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeout?: number;
}

const captureChildOutput = [
  'const { closeSync, openSync } = require("node:fs");',
  'const { spawnSync } = require("node:child_process");',
  'const [stdoutPath, stderrPath, timeoutRaw, command, ...args] = process.argv.slice(1);',
  'const timeout = timeoutRaw === "" ? undefined : Number(timeoutRaw);',
  'const stdoutFd = openSync(stdoutPath, "w");',
  'const stderrFd = openSync(stderrPath, "w");',
  'let status = 1;',
  'try {',
  '  status = spawnSync(command, args, { stdio: ["ignore", stdoutFd, stderrFd], timeout }).status ?? 1;',
  '} finally {',
  '  closeSync(stdoutFd);',
  '  closeSync(stderrFd);',
  '}',
  'process.exit(status);',
].join('\n');

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
    return {
      status: wrapper.status,
      stdout: readFileSync(stdoutPath, 'utf8'),
      stderr: readFileSync(stderrPath, 'utf8'),
    };
  } finally {
    rmSync(captureDir, { recursive: true, force: true });
  }
}
