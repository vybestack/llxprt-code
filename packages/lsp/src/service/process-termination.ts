/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250212-LSP.P12
 * @requirement REQ-LIFE-010
 */

import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';

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
  if (await isProcessAliveAsync(proc)) {
    throw new Error('Child process did not close after forced termination');
  }
}

/**
 * Async liveness check that delegates to the OS-native query on Windows.
 * On POSIX, falls back to the synchronous signal-0 probe.
 */
async function isProcessAliveAsync(
  proc: ChildProcessWithoutNullStreams,
): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return false;
  }
  const pid = proc.pid;
  if (pid === undefined) {
    return true;
  }
  if (process.platform === 'win32') {
    return isWindowsPidAlive(pid);
  }
  return isPosixPidAlive(pid);
}

/**
 * Sync POSIX liveness probe via signal-0. Used for the direct-kill fallback
 * path where a synchronous check is sufficient.
 */
function isPosixPidAlive(pid: number): boolean {
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

  // Check whether the process is already gone before issuing taskkill. When
  // the server self-exits (e.g. after an acknowledged shutdown), Bun's
  // ChildProcess bookkeeping may be stale, but the OS-level PID is gone.
  // Since tasklist confirms external termination, there is no need to wait
  // for a close event that may never be emitted by Bun's stale wrapper.
  if (!isWindowsPidAlive(pid)) {
    return;
  }

  try {
    await runTaskkill(pid);
  } catch (taskkillError: unknown) {
    if (isProcessTerminated(proc)) {
      await awaitForcedTermination(proc, closePromise);
      return;
    }
    // taskkill may report the PID as already absent when the process exited
    // between our pre-check and the kill attempt. Use the OS-native tasklist
    // query to confirm whether the process is genuinely gone; a confirmed
    // absent PID is successful cleanup.
    if (!isWindowsPidAlive(pid)) {
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

/**
 * Queries the Windows OS directly for whether a PID is still running, using
 * `tasklist /FI "PID eq <pid>" /FO CSV /NH`. This is an externally observable
 * process-state query that is independent of Bun's ChildProcess bookkeeping
 * (which can be stale for a `bun run` wrapper after the child self-exits).
 *
 * Uses exact PID parsing from CSV output — does not rely on localized error
 * strings. Returns true when the PID is confirmed alive; returns false when
 * tasklist confirms the PID is absent. A tasklist invocation error surfaces
 * as true (fail-safe: a query error must not be treated as success).
 */
function isWindowsPidAlive(pid: number): boolean {
  const result = spawnSync(
    'tasklist',
    ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
    {
      windowsHide: true,
      encoding: 'utf8',
      timeout: FORCE_KILL_CLOSE_TIMEOUT_MS,
    },
  );
  if (result.error !== undefined || result.status !== 0) {
    // tasklist itself failed or timed out — fail-safe: treat as alive so the
    // caller surfaces the error rather than silently succeeding.
    return true;
  }
  const stdout = result.stdout ?? '';
  return parseTasklistCsvForPid(stdout, pid);
}

/**
 * Parses tasklist CSV output for an exact PID match. The `/NH` flag suppresses
 * the header row, so a present process yields one line like:
 *   "bun.exe","12345","Console","1","5,120 K"
 * An absent process yields an informational line (not CSV), which will not
 * contain the PID as a quoted CSV field.
 */
function parseTasklistCsvForPid(csvOutput: string, pid: number): boolean {
  const pidString = String(pid);
  for (const line of csvOutput.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const fields = parseCsvLine(trimmed);
    if (fields.length >= 2 && fields[1] === pidString) {
      return true;
    }
  }
  return false;
}

/**
 * Minimal CSV line parser for tasklist output: splits on commas outside
 * quotes and strips surrounding quotes.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === undefined) {
      continue;
    }
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}
