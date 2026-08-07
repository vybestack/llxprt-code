/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn as cpSpawn, type ChildProcess } from 'node:child_process';
import type { ExitGuard } from './shellExitGuard.js';

export const SIGKILL_TIMEOUT_MS = 200;

/**
 * Fire-and-forget taskkill on Windows.  The arguments are explicit and
 * fully controlled; `sonarjs/no-os-command-from-path` is centrally
 * disabled for this codebase.
 */
export function taskkillTree(pid: number): void {
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
export function boundedTaskkill(pid: number): Promise<TaskkillResult> {
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
  pid: number,
  exitedGuard: ExitGuard,
  killFallback: () => void,
): Promise<void> {
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
  pid: number,
  isWindows: boolean,
  killChildFallback: () => void,
  exitedGuard: ExitGuard,
): Promise<void> {
  if (isWindows) {
    taskkillTree(pid);
    return;
  }
  await escalateKillUnix(pid, exitedGuard, killChildFallback);
}
