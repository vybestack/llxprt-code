/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn as cpSpawn } from 'node:child_process';
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
