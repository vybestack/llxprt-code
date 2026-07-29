/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250212-LSP.P12
 * @requirement REQ-LIFE-010
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const FORCE_KILL_CLOSE_TIMEOUT_MS = 1_500;

export function observeProcessClose(
  proc: ChildProcessWithoutNullStreams,
): Promise<void> {
  return new Promise<void>((resolve) => {
    proc.once('close', () => resolve());
  });
}

function waitForProcessClose(
  closePromise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    void closePromise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export async function closeProcessAfterGrace(
  proc: ChildProcessWithoutNullStreams,
  closePromise: Promise<void>,
  graceMs: number,
): Promise<void> {
  if (!(await waitForProcessClose(closePromise, graceMs))) {
    await forceKillProcess(proc, closePromise);
  }
}

export async function shutdownProcess(
  proc: ChildProcessWithoutNullStreams,
  closePromise: Promise<void>,
  graceMs: number,
  primaryError: Error | null,
): Promise<void> {
  let cleanupError: unknown = null;
  try {
    await closeProcessAfterGrace(proc, closePromise, graceMs);
  } catch (error: unknown) {
    cleanupError = error;
  }
  if (primaryError !== null && cleanupError !== null) {
    throw new AggregateError(
      [primaryError, cleanupError],
      'Child process failed during shutdown and cleanup',
    );
  }
  if (cleanupError !== null) throw cleanupError;
  if (primaryError !== null) throw primaryError;
}

async function awaitProcessClose(closePromise: Promise<void>): Promise<void> {
  const closed = await waitForProcessClose(
    closePromise,
    FORCE_KILL_CLOSE_TIMEOUT_MS,
  );
  if (!closed) {
    throw new Error('Child process did not close after forced termination');
  }
}

/**
 * Force-terminates the child and awaits its `close` event. Windows uses
 * `taskkill /F /T` to terminate the process tree; POSIX sends SIGKILL to the
 * direct child. Failures surface rather than being swallowed.
 */
export async function forceKillProcess(
  proc: ChildProcessWithoutNullStreams,
  closePromise: Promise<void>,
): Promise<void> {
  const pid = proc.pid;
  if (pid === undefined) {
    await awaitProcessClose(closePromise);
    return;
  }

  if (process.platform === 'win32') {
    await forceKillWindows(proc, closePromise, pid);
    return;
  }

  if (!isProcessTerminated(proc) && !proc.kill('SIGKILL')) {
    throw new Error(`Failed to send SIGKILL to child process ${pid}`);
  }

  await awaitProcessClose(closePromise);
}

function isProcessTerminated(proc: ChildProcessWithoutNullStreams): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

async function forceKillWindows(
  proc: ChildProcessWithoutNullStreams,
  closePromise: Promise<void>,
  pid: number,
): Promise<void> {
  if (isProcessTerminated(proc)) {
    await awaitProcessClose(closePromise);
    return;
  }

  try {
    await runTaskkill(pid);
  } catch (taskkillError: unknown) {
    if (isProcessTerminated(proc)) {
      await awaitProcessClose(closePromise);
      return;
    }
    const signalError = !proc.kill('SIGKILL')
      ? new Error(`Failed to terminate child process ${pid}`)
      : undefined;
    try {
      await awaitProcessClose(closePromise);
    } catch (closeError: unknown) {
      throw new AggregateError(
        signalError === undefined
          ? [taskkillError, closeError]
          : [taskkillError, signalError, closeError],
        `Failed to force-terminate child process ${pid}`,
      );
    }
    if (signalError !== undefined) {
      throw new AggregateError(
        [taskkillError, signalError],
        `Failed to force-terminate child process ${pid}`,
      );
    }
    return;
  }

  await awaitProcessClose(closePromise);
}

function runTaskkill(pid: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', reject);
    killer.once('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`taskkill exited with code ${String(code)}`));
      }
    });
  });
}
