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

async function awaitForcedTermination(
  proc: ChildProcessWithoutNullStreams,
  closePromise: Promise<void>,
): Promise<void> {
  const closed = await waitForProcessClose(
    closePromise,
    FORCE_KILL_CLOSE_TIMEOUT_MS,
  );
  if (closed) {
    return;
  }
  // The `close` event was not emitted within the timeout. On Windows,
  // Bun's ChildProcess may not emit `close` for a process terminated
  // externally via taskkill, even though the OS-level termination
  // succeeded. Confirm the requested outcome via externally observable
  // process state rather than surfacing an implementation-detail error.
  if (isProcessAlive(proc)) {
    throw new Error('Child process did not close after forced termination');
  }
}

/**
 * Returns true when the child process is still running, using externally
 * observable state. Trusts the ChildProcess's own exit/signal report when
 * available; otherwise probes the OS via signal-0 so that a process killed
 * by an external mechanism (e.g. Windows taskkill) is correctly detected
 * even if the ChildProcess never emitted `exit`/`close`.
 */
function isProcessAlive(proc: ChildProcessWithoutNullStreams): boolean {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return false;
  }
  const pid = proc.pid;
  if (pid === undefined) {
    return true;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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
    await awaitForcedTermination(proc, closePromise);
    return;
  }

  if (process.platform === 'win32') {
    await forceKillWindows(proc, closePromise, pid);
    return;
  }

  if (!isProcessTerminated(proc) && !proc.kill('SIGKILL')) {
    throw new Error(`Failed to send SIGKILL to child process ${pid}`);
  }

  await awaitForcedTermination(proc, closePromise);
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
    await awaitForcedTermination(proc, closePromise);
    return;
  }

  try {
    await runTaskkill(pid);
  } catch (taskkillError: unknown) {
    if (isProcessTerminated(proc)) {
      await awaitForcedTermination(proc, closePromise);
      return;
    }
    const signalError = !proc.kill('SIGKILL')
      ? new Error(`Failed to terminate child process ${pid}`)
      : undefined;
    try {
      await awaitForcedTermination(proc, closePromise);
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

  await awaitForcedTermination(proc, closePromise);
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
