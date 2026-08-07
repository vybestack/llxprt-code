/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { boundedTaskkill } from '../../src/services/shellProcessKill.js';
import {
  ShellJobDisposalError,
  type ShellJobManager,
} from '../../src/services/shellJobManager.js';
import { debugLogger } from '../../src/utils/debugLogger.js';

/**
 * Shared Windows test-cleanup helpers for the ShellJobManager suites.
 *
 * This is a TEST-ONLY module: it lives under packages/core/test/utils, which
 * the core tsconfig does not include in production compilation (its `include`
 * covers only index.ts and src/**). Do not import it from production code.
 *
 * Why the inner PowerShell PID matters: production spawnWindowsBackground
 * launches an OUTER PowerShell (the pid the manager tracks; its own stdio is
 * ignored) whose bootstrap runs Start-Process to create an INNER PowerShell.
 * The INNER process owns the redirected stdout/stderr log handles
 * (-RedirectStandardOutput / -RedirectStandardError) on files that live in
 * the manager's base directory. When a test injects a failing/never-settling
 * taskkill, the manager never reaps the tree; even this helper's real
 * taskkill /T rooted at the outer pid can race and leave the inner process
 * alive, holding EBUSY locks on those log files. Callers that launch a
 * long-running command under an injected failing kill must therefore capture
 * the INNER pid via a marker file (buildInnerPidMarkerCommand /
 * readInnerPidFromMarker) and pass BOTH the outer job pid and the inner pid
 * to reapAndRemoveWindowsTestDir so the inner is directly reaped and
 * confirmed gone.
 */

export async function disposeAndCleanupWindowsTest(
  dir: string,
  manager: ShellJobManager,
  pids: readonly number[],
  allowSurvivorError = false,
): Promise<void> {
  let disposalError: unknown;
  try {
    await manager.dispose();
  } catch (error) {
    disposalError = error;
  }

  try {
    await reapAndRemoveWindowsTestDir(dir, manager, pids);
  } catch (cleanupError) {
    if (disposalError !== undefined) {
      throw new AggregateError(
        [disposalError, cleanupError],
        'Shell-job disposal and deterministic cleanup both failed',
      );
    }
    throw cleanupError;
  }

  if (disposalError === undefined) return;
  if (
    !allowSurvivorError ||
    !(disposalError instanceof ShellJobDisposalError)
  ) {
    throw disposalError;
  }
}

/** Transient Windows removal codes that warrant a bounded retry. */
const TRANSIENT_REMOVAL_CODES: ReadonlySet<string> = new Set([
  'EBUSY',
  'EPERM',
  'ENOTEMPTY',
]);

function errorCodeOf(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

function isPidAliveWindows(pid: number): boolean {
  const result = spawnSync(
    'tasklist',
    ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'],
    { encoding: 'utf8', timeout: 5000 },
  );
  if (result.error !== undefined) {
    throw new Error(`tasklist failed while checking PID ${pid}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const output = result.stderr || result.stdout || '(no output)';
    throw new Error(
      `tasklist exited with status ${result.status} while checking PID ${pid}: ${output}`,
    );
  }
  return result.stdout.includes(String(pid));
}

/**
 * Poll until tasklist no longer reports the pid. Fail-fast: throws if the
 * process is still alive after the deadline. This tasklist check is the
 * deterministic gate that a targeted pid has actually been terminated.
 */
async function waitForPidGoneWindows(
  pid: number,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAliveWindows(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `PID ${pid} still alive after ${timeoutMs}ms — possible process leak`,
  );
}

/**
 * Poll until a PID is confirmed alive or gone on Windows.
 */
export async function waitForPidStateWindows(
  pid: number,
  alive: boolean,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPidAliveWindows(pid) === alive) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `PID ${pid} did not become ${alive ? 'alive' : 'gone'} within ${timeoutMs}ms`,
  );
}

const TRANSIENT_PID_FILE_CODES = new Set(['ENOENT', 'EACCES', 'EPERM']);

function readPositivePid(filePath: string): number | null {
  try {
    const pid = Number(fs.readFileSync(filePath, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    const code = errorCodeOf(error);
    if (code !== undefined && TRANSIENT_PID_FILE_CODES.has(code)) {
      return null;
    }
    throw error;
  }
}

async function pollPositivePidFile(
  filePath: string,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = readPositivePid(filePath);
    if (pid !== null) {
      return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(timeoutMessage);
}

/**
 * Poll until a PID file appears and contains a positive integer.
 */
export function waitForPidFile(
  filePath: string,
  timeoutMs: number,
): Promise<number> {
  return pollPositivePidFile(
    filePath,
    timeoutMs,
    `PID file ${filePath} did not appear within ${timeoutMs}ms`,
  );
}

/**
 * Wait for a manager's survivor tracking to reach zero.
 *
 * SUPPLEMENTAL ONLY: getLiveSurvivorCount reflects the OUTER ChildProcess
 * liveness the manager tracks (the Node child-process exit lifecycle, drained
 * via handleExit when the outer process terminates). It does NOT prove the
 * inner PowerShell — which owns the redirected log handles — has exited or
 * released its handles; that is established solely by the explicit taskkill +
 * tasklist verification of every passed pid. This drain only confirms the
 * manager has observed the outer child exit. Throws if outer survivors never
 * release.
 */
async function waitForOuterSurvivorsReaped(
  manager: ShellJobManager,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (manager.getLiveSurvivorCount() === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `${manager.getLiveSurvivorCount()} outer survivor(s) still live after ${timeoutMs}ms — possible process leak`,
  );
}

/**
 * Remove a Windows test directory. Retries only on transient OS codes
 * (EBUSY/EPERM/ENOTEMPTY) for a bounded window; throws immediately on
 * non-transient errors or deadline expiry. Never silently swallows a failure.
 *
 * The transient retry exists because tasklist can report a pid gone before
 * the kernel releases that process's redirected-log file handles, so even
 * after every pid is confirmed terminated the directory removal can briefly
 * race with OS handle release.
 */
async function removeWindowsTestDir(
  dir: string,
  timeoutMs = 10000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = errorCodeOf(error);
      if (
        Date.now() >= deadline ||
        code === undefined ||
        !TRANSIENT_REMOVAL_CODES.has(code)
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export interface ReapAndRemoveOptions {
  /** Timeout for each reap-confirm and directory-removal phase (default 10s). */
  readonly timeoutMs?: number;
}

/**
 * Reap every unique positive pid, confirm each is gone, optionally drain the
 * manager's outer-survivor tracking, then remove the test directory.
 *
 * Order is deliberate:
 *   1. For each unique positive pid still alive, run a bounded real taskkill.
 *      A non-OK result is TOLERATED here only because step 2 verifies the pid
 *      is gone — a parent/child cleanup race can make taskkill report a
 *      non-zero exit even when the tree is already dead. If the pid is NOT
 *      confirmed gone in step 2, waitForPidGoneWindows throws (fail-fast).
 *   2. Confirm every unique positive pid is gone via tasklist — the
 *      deterministic gate, covering both the outer pid and the inner
 *      PowerShell that owns the redirected log handles.
 *   3. Supplemental: drain the manager's outer-survivor count to zero. This
 *      reflects only outer ChildProcess liveness, NOT inner handle release.
 *   4. Remove the directory with a bounded transient-retry window.
 *
 * Throws on any pid that never dies or any directory that cannot be removed.
 *
 * @param dir - Test directory to remove.
 * @param manager - Manager whose OUTER survivors should drain before removal
 *   (null when the test has no manager-managed survivors).
 * @param pids - All unique positive pids to reap and confirm gone: the outer
 *   job pid plus any inner PowerShell pids that own redirected log handles.
 */
export async function reapAndRemoveWindowsTestDir(
  dir: string,
  manager: ShellJobManager | null,
  pids: readonly number[] = [],
  options: ReapAndRemoveOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const uniquePids = Array.from(new Set(pids.filter((pid) => pid > 0)));

  // 1. Reap each live pid via real bounded taskkill. A non-OK result is
  //    tolerated only because step 2 verifies the pid is gone via tasklist;
  //    a pid that survives step 2 makes waitForPidGoneWindows throw.
  for (const pid of uniquePids) {
    if (isPidAliveWindows(pid)) {
      const result = await boundedTaskkill(pid);
      if (!result.ok) {
        debugLogger.warn(
          `[shellJobTestCleanup] taskkill for pid ${pid} failed (will verify via tasklist): ${result.error?.message ?? 'unknown failure'}`,
        );
      }
    }
  }

  // 2. Confirm every pid is gone — the deterministic gate for outer AND inner.
  for (const pid of uniquePids) {
    await waitForPidGoneWindows(pid, timeoutMs);
  }

  // 3. Supplemental: drain the manager's outer-survivor count to zero. This
  //    reflects only outer ChildProcess liveness, not inner handle release.
  if (manager !== null) {
    await waitForOuterSurvivorsReaped(manager, timeoutMs);
  }

  // 4. Remove the directory. After steps 1–3 the processes are confirmed
  //    dead, so a short transient retry covers the OS handle-release window.
  await removeWindowsTestDir(dir, timeoutMs);
}

/**
 * Build a PowerShell command that writes the INNER process's $PID to a unique
 * marker file, then sleeps. spawnWindowsBackground's outer PowerShell runs an
 * inner PowerShell (via Start-Process) that owns the redirected log handles
 * and executes this command; inside it, $PID is the INNER PowerShell pid.
 * Used by tests that inject a failing/never-settling taskkill so teardown can
 * directly reap the inner process instead of relying on taskkill /T racing
 * down from the outer pid.
 */
export function buildInnerPidMarkerCommand(
  markerPath: string,
  sleepSeconds = 300,
  beforeSleepCommand?: string,
): string {
  const escaped = markerPath.replace(/'/g, "''");
  const beforeSleep =
    beforeSleepCommand === undefined ? '' : `${beforeSleepCommand}; `;
  return (
    `$PID | Out-File -FilePath '${escaped}' -Encoding ASCII; ` +
    beforeSleep +
    `Start-Sleep -Seconds ${sleepSeconds}`
  );
}

/**
 * Poll a marker file until it parses as a positive pid. Fail-fast: throws if
 * the marker is never written within the deadline.
 */
export function readInnerPidFromMarker(
  markerPath: string,
  timeoutMs = 10000,
): Promise<number> {
  return pollPositivePidFile(
    markerPath,
    timeoutMs,
    `Inner PID marker ${markerPath} not written within ${timeoutMs}ms`,
  );
}
