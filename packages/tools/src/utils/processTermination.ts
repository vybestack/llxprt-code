/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';

export const DEFAULT_TERMINATION_GRACE_MS = 5000;
export const WINDOWS_TASKKILL_WATCHDOG_MS = 10000;
const GROUP_POLL_INTERVAL_MS = 50;
const POST_KILL_WAIT_MS = 1000;

export type ProcessTerminationOutcome =
  | 'no_target'
  | 'graceful'
  | 'escalated'
  | 'timeout'
  | 'failure';

export interface ProcessTerminationResult {
  readonly outcome: ProcessTerminationOutcome;
}

export type SignalFn = (pid: number, signal: NodeJS.Signals | 0) => void;

const defaultSignal: SignalFn = (pid, signal) => process.kill(pid, signal);

export interface WindowsTerminationOptions {
  watchdogMs?: number;
  postKillWaitMs?: number;
}

export interface ProcessTerminationOptions {
  gracePeriodMs?: number;
  ownsProcessGroup?: boolean;
  signal?: SignalFn;
}

const activeTerminations = new WeakMap<
  ChildProcess,
  Promise<ProcessTerminationResult>
>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function groupExists(signal: SignalFn, pgid: number): boolean {
  try {
    signal(-pgid, 0);
    return true;
  } catch (e) {
    return !isErrnoException(e) || e.code !== 'ESRCH';
  }
}

async function waitForGroupGone(
  signal: SignalFn,
  pgid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!groupExists(signal, pgid)) return true;
    await sleep(GROUP_POLL_INTERVAL_MS);
  }
  return !groupExists(signal, pgid);
}

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForChildExit(
  child: ChildProcess,
  timeoutMs: number,
): Promise<boolean> {
  if (childExited(child)) return true;
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (result: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(result);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(childExited(child)), timeoutMs);
    if (childExited(child)) {
      finish(true);
      return;
    }
    child.once('exit', onExit);
  });
}

export async function terminateProcessTree(
  child: ChildProcess,
  options?: ProcessTerminationOptions,
): Promise<ProcessTerminationResult> {
  const pid = child.pid;
  if (pid === undefined) {
    return { outcome: 'no_target' };
  }

  const ownedGroup =
    options?.ownsProcessGroup === true && process.platform !== 'win32';

  if (!ownedGroup && childExited(child)) {
    return { outcome: 'no_target' };
  }

  const existing = activeTerminations.get(child);
  if (existing !== undefined) {
    return existing;
  }

  const promise = doTerminate(child, options).finally(() => {
    activeTerminations.delete(child);
  });
  activeTerminations.set(child, promise);
  return promise;
}

async function doTerminate(
  child: ChildProcess,
  options?: ProcessTerminationOptions,
): Promise<ProcessTerminationResult> {
  const pid = child.pid;
  if (pid === undefined) {
    return { outcome: 'no_target' };
  }

  const signal = options?.signal ?? defaultSignal;
  const gracePeriod = options?.gracePeriodMs ?? DEFAULT_TERMINATION_GRACE_MS;

  if (process.platform === 'win32') {
    return terminateWindowsTree(pid);
  }

  if (options?.ownsProcessGroup === true) {
    if (!groupExists(signal, pid)) {
      return { outcome: 'no_target' };
    }
    return terminateOwnedGroup(signal, pid, gracePeriod);
  }

  if (childExited(child)) {
    return { outcome: 'no_target' };
  }

  return terminateDirectChild(signal, child, pid, gracePeriod);
}

function isErrnoException(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && 'code' in e;
}

function signalFailedBecauseGone(e: unknown): boolean {
  return isErrnoException(e) && e.code === 'ESRCH';
}

async function terminateOwnedGroup(
  signal: SignalFn,
  pgid: number,
  gracePeriodMs: number,
): Promise<ProcessTerminationResult> {
  try {
    signal(-pgid, 'SIGTERM');
  } catch (e) {
    if (signalFailedBecauseGone(e)) return { outcome: 'no_target' };
    if (
      isErrnoException(e) &&
      e.code === 'EPERM' &&
      (await waitForGroupGone(signal, pgid, POST_KILL_WAIT_MS))
    ) {
      return { outcome: 'graceful' };
    }
    return { outcome: 'failure' };
  }

  if (await waitForGroupGone(signal, pgid, gracePeriodMs)) {
    return { outcome: 'graceful' };
  }

  try {
    signal(-pgid, 'SIGKILL');
  } catch (e) {
    if (signalFailedBecauseGone(e)) return { outcome: 'no_target' };
    if (
      isErrnoException(e) &&
      e.code === 'EPERM' &&
      (await waitForGroupGone(signal, pgid, POST_KILL_WAIT_MS))
    ) {
      return { outcome: 'escalated' };
    }
    return { outcome: 'failure' };
  }

  if (await waitForGroupGone(signal, pgid, POST_KILL_WAIT_MS)) {
    return { outcome: 'escalated' };
  }

  return { outcome: 'timeout' };
}

async function terminateDirectChild(
  signal: SignalFn,
  child: ChildProcess,
  pid: number,
  gracePeriodMs: number,
): Promise<ProcessTerminationResult> {
  try {
    signal(pid, 'SIGTERM');
  } catch (e) {
    return { outcome: signalFailedBecauseGone(e) ? 'no_target' : 'failure' };
  }

  if (await waitForChildExit(child, gracePeriodMs)) {
    return { outcome: 'graceful' };
  }

  try {
    signal(pid, 'SIGKILL');
  } catch (e) {
    return { outcome: signalFailedBecauseGone(e) ? 'no_target' : 'failure' };
  }

  if (await waitForChildExit(child, POST_KILL_WAIT_MS)) {
    return { outcome: 'escalated' };
  }

  return { outcome: 'timeout' };
}

export type TaskkillSpawnFn = (pid: number) => ChildProcess;

export const defaultTaskkillSpawn: TaskkillSpawnFn = (pid: number) =>
  spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
  });

export function terminateWindowsTree(
  pid: number,
  spawnTaskkill: TaskkillSpawnFn = defaultTaskkillSpawn,
  options?: WindowsTerminationOptions,
): Promise<ProcessTerminationResult> {
  const watchdogMs = options?.watchdogMs ?? WINDOWS_TASKKILL_WATCHDOG_MS;
  const postKillWaitMs = options?.postKillWaitMs ?? POST_KILL_WAIT_MS;
  return new Promise<ProcessTerminationResult>((resolve) => {
    let kill: ChildProcess;
    try {
      kill = spawnTaskkill(pid);
    } catch {
      resolve({ outcome: 'failure' });
      return;
    }

    let settled = false;
    let postKillTimer: ReturnType<typeof setTimeout> | null = null;

    const onWatchdogClose = () => resolveOnce('timeout');

    const resolveOnce = (outcome: ProcessTerminationOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      if (postKillTimer !== null) clearTimeout(postKillTimer);
      kill.removeListener('close', onClose);
      kill.removeListener('close', onWatchdogClose);
      kill.removeListener('error', onError);
      resolve({ outcome });
    };

    const onClose = (code: number | null) => {
      if (code === 0) {
        resolveOnce('graceful');
      } else if (code === 128) {
        resolveOnce('no_target');
      } else {
        resolveOnce('failure');
      }
    };

    const onError = () => {
      try {
        kill.kill();
      } catch {
        // best-effort
      }
      resolveOnce('failure');
    };

    const watchdog = setTimeout(() => {
      kill.removeListener('close', onClose);
      try {
        kill.kill();
      } catch {
        // best-effort
      }
      kill.once('close', onWatchdogClose);
      postKillTimer = setTimeout(() => resolveOnce('timeout'), postKillWaitMs);
    }, watchdogMs);

    kill.on('close', onClose);
    kill.on('error', onError);
  });
}
