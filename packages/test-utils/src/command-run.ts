/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { InteractiveRunOptions, InteractiveRunResult } from './types.js';

/**
 * Return a guaranteed-non-null stream. Used with `stdio: 'pipe'` spawns,
 * which always allocate stdout/stderr streams.
 */
function getStream(stream: Readable | null): Readable {
  if (stream === null) {
    throw new Error('Expected spawn stdio stream but received null');
  }
  return stream;
}

/**
 * Command-based run for non-PTY process management.
 * Supports timeout, graceful kill escalation, and cross-platform handling.
 */
export class CommandRun {
  private _process: ChildProcess | null = null;
  private _stdout = '';
  private _stderr = '';
  private _exitCode: number | null = null;
  private _killed = false;
  private _timedOut = false;
  private _exited = false;

  /**
   * Get the process ID if running.
   */
  get pid(): number | undefined {
    return this._process?.pid;
  }

  /**
   * Get the exit code after process completes.
   */
  get exitCode(): number | null {
    return this._exitCode;
  }

  /**
   * Check if the process was killed.
   */
  get killed(): boolean {
    return this._killed;
  }

  /**
   * Run a command with optional timeout.
   */
  async run(
    command: string,
    args: string[],
    options?: InteractiveRunOptions,
  ): Promise<InteractiveRunResult> {
    const timeout = options?.timeout ?? 30000;
    const cwd = process.cwd();

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        stdio: 'pipe',
      });
      this._process = child;

      // stdio: 'pipe' guarantees non-null streams.
      const stdout = getStream(child.stdout);
      stdout.on('data', (data: Buffer) => {
        this._stdout += data.toString();
      });

      const stderr = getStream(child.stderr);
      stderr.on('data', (data: Buffer) => {
        this._stderr += data.toString();
      });

      child.on('error', (error) => {
        const err = new Error(
          `Failed to spawn '${command}': ${error.message} (errno: ${(error as NodeJS.ErrnoException).errno ?? 'unknown'})`,
        );
        reject(err);
      });

      const timer = setTimeout(() => {
        this._timedOut = true;
        this.kill(options?.gracefulKillTimeout ?? 5000).catch(() => {
          // Ignore kill errors on timeout
        });
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timer);
        this._exited = true;
        this._exitCode = code;
        resolve({
          exitCode: this._exitCode,
          stdout: this._stdout,
          stderr: this._stderr,
          timedOut: this._timedOut,
          killed: this._killed,
        });
      });
    });
  }

  /**
   * Kill the process with graceful escalation.
   * First sends SIGTERM, then SIGKILL after timeout.
   * On Windows, uses taskkill with /T flag for process tree.
   */
  async kill(gracefulTimeout?: number): Promise<void> {
    if (this._exited || this._process === null) {
      return;
    }

    const timeout = gracefulTimeout ?? 5000;
    this._killed = true;
    const pid = this._process.pid;

    if (pid === undefined) {
      return;
    }

    if (process.platform === 'win32') {
      await killProcessTreeWindows(pid);
    } else {
      await killProcessTreeUnix(pid, timeout, () => this._exited);
    }
  }
}

/**
 * Safely extract a string message from a caught value of unknown shape.
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Safely read the errno code from a caught value.
 */
function errorCode(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

/**
 * Windows process-tree kill using taskkill with the /T flag.
 */
function killProcessTreeWindows(pid: number): Promise<void> {
  try {
    execSync(`taskkill /pid ${pid} /T /F`, {
      timeout: 10000,
    });
  } catch (error) {
    const message = errorMessage(error);
    if (
      message.includes('not found') ||
      message.includes('no running instance')
    ) {
      return Promise.resolve();
    }
    if (message.includes('Access is denied')) {
      throw new Error(
        `Permission denied when trying to kill process ${pid}. Try running with elevated privileges.`,
      );
    }
    throw error;
  }
  return Promise.resolve();
}

/**
 * Unix graceful kill: SIGTERM, then SIGKILL after timeout.
 */
async function killProcessTreeUnix(
  pid: number,
  timeout: number,
  hasExited: () => boolean,
): Promise<void> {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ESRCH') {
      return;
    }
    if (code === 'EPERM') {
      throw new Error(
        `Permission denied when trying to kill process ${pid}. Try running with elevated privileges.`,
      );
    }
    throw error;
  }

  const startTime = Date.now();
  const exited = await new Promise<boolean>((resolve) => {
    const checkInterval = setInterval(() => {
      if (hasExited()) {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }

      try {
        process.kill(pid, 0);
      } catch {
        clearInterval(checkInterval);
        resolve(true);
        return;
      }

      if (Date.now() - startTime >= timeout) {
        clearInterval(checkInterval);
        resolve(false);
      }
    }, 100);
  });

  if (!exited) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (errorCode(error) !== 'ESRCH') {
        throw error;
      }
    }
  }
}
