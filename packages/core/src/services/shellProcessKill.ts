/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn as cpSpawn, type ChildProcess } from 'node:child_process';
import type { ExitGuard } from './shellExitGuard.js';

export const SIGKILL_TIMEOUT_MS = 200;

/**
 * The single chokepoint that keeps a non-killable pid away from every
 * process-kill primitive. POSIX `kill(2)` overloads its pid argument:
 * `0` signals the caller's own process group, negative values target a group
 * (or, for `-1`, every signalable process), and `NaN`/`Infinity` are never
 * valid. Rejecting those here turns a catastrophic `kill(0)` into a no-op.
 *
 * Integrality is required as well: a fractional value could be truncated by
 * the runtime after the `-pid` negation and land on an unrelated process
 * group, so only whole positive numbers are accepted.
 */
export function isKillablePid(pid: unknown): pid is number {
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0;
}

/**
 * Fire-and-forget taskkill on Windows.  The arguments are explicit and
 * fully controlled; `sonarjs/no-os-command-from-path` is centrally
 * disabled for this codebase.
 */
export function taskkillTree(pid: number | undefined): void {
  if (!isKillablePid(pid)) {
    return;
  }
  cpSpawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
}

/** Outcome of an observed taskkill attempt. */
export interface TaskkillResult {
  ok: boolean;
  error?: Error;
}

/** Maximum time to wait for a taskkill subprocess before giving up. */
export const TASKKILL_TIMEOUT_MS = 5000;

/**
 * Bounded, never-rejecting Windows taskkill. Races the taskkill subprocess
 * against a timer, kills the subprocess on timeout, and always resolves with
 * a {@link TaskkillResult}. The timer stays referenced while callers await this
 * operation and is cleared on settle, guaranteeing forward progress even though
 * the taskkill child itself is unref'd.
 */
export function boundedTaskkill(
  pid: number | undefined,
): Promise<TaskkillResult> {
  if (!isKillablePid(pid)) {
    // Preserve the never-rejecting contract: an invalid pid is rejected here
    // rather than handed to taskkill, which on Windows would either error or,
    // worse, accept a misleading value.
    return Promise.resolve({
      ok: false,
      error: new Error(`Refusing taskkill of non-killable pid: ${String(pid)}`),
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    // Declared before the guarded cpSpawn so a synchronous spawn throw can
    // route through finish() (which clears the timer) instead of rejecting.
    let child: ChildProcess;

    const finish = (result: TaskkillResult): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Process may already be gone — sanctioned catch.
      }
      finish({
        ok: false,
        error: new Error(`taskkill timed out after ${TASKKILL_TIMEOUT_MS}ms`),
      });
    }, TASKKILL_TIMEOUT_MS);

    // cpSpawn can throw synchronously (e.g. EMFILE/ENOMEM under resource
    // pressure). Catch it so the never-rejecting contract is preserved: route
    // through finish() (which also cancels the timer) and stop before attaching
    // listeners, since child was never assigned.
    try {
      child = cpSpawn('taskkill', ['/pid', pid.toString(), '/f', '/t'], {
        stdio: 'ignore',
      });
      child.unref();
    } catch (e) {
      finish({
        ok: false,
        error: e instanceof Error ? e : new Error(String(e)),
      });
      return;
    }

    child.on('error', (err: Error) => finish({ ok: false, error: err }));
    child.on('close', (code: number | null) => {
      if (code === 0) {
        finish({ ok: true, error: undefined });
        return;
      }
      // A null code means the kill helper was itself terminated by a signal,
      // which is a different failure from a non-zero taskkill exit status.
      const error =
        code === null
          ? new Error('taskkill was terminated by a signal')
          : new Error(`taskkill exited with code ${code}`);
      finish({ ok: false, error });
    });
  });
}

/**
 * Send SIGTERM then, after a short grace period, SIGKILL to a Unix
 * process group, guarded by the shared {@link ExitGuard} so that a
 * process that exits during the grace period is not killed again.
 */
export async function escalateKillUnix(
  pid: number | undefined,
  exitedGuard: ExitGuard,
  killFallback: () => void,
): Promise<void> {
  if (!isKillablePid(pid)) {
    // A non-killable pid must never reach process.kill(-pid): pid 0 would
    // signal the caller's own process group. Treat it as already gone.
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
    await new Promise((res) => setTimeout(res, SIGKILL_TIMEOUT_MS));
    if (!exitedGuard.isExited()) {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    if (!exitedGuard.isExited()) {
      killFallback();
    }
  }
}

/**
 * Platform-aware escalation kill used by the child_process and PTY
 * paths.  Windows uses taskkill; Unix uses SIGTERM → SIGKILL.
 */
export async function killProcessWithEscalation(
  pid: number | undefined,
  isWindows: boolean,
  killChildFallback: () => void,
  exitedGuard: ExitGuard,
): Promise<void> {
  if (!isKillablePid(pid)) {
    return;
  }
  if (isWindows) {
    taskkillTree(pid);
    return;
  }
  await escalateKillUnix(pid, exitedGuard, killChildFallback);
}
