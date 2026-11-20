/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';

/**
 * How long a payload may keep running after SIGTERM or SIGHUP before the
 * sandbox is killed. Ten seconds is the default stop timeout of `docker stop`
 * and `podman stop`, twice the 5 s the ACP terminal manager gives a child it
 * is closing, and the bound within which healthy sandboxed runs ended in live
 * checks (0.3 s to 3 s measured).
 */
export const BWRAP_STOP_GRACE_MS = 10_000;

/** Signals that ask the sandbox to end, as opposed to SIGINT's "cancel". */
const TERMINATION_SIGNALS: ReadonlySet<NodeJS.Signals> = new Set([
  'SIGTERM',
  'SIGHUP',
]);

export interface BwrapSignalDeliveryOptions {
  /** Grace period after SIGTERM or SIGHUP before the sandbox is SIGKILLed. */
  readonly stopGraceMs?: number;
}

/**
 * The sandbox runs in a private PID namespace whose init is a second bwrap
 * process. That init reaps orphans and ends the namespace, and every process
 * in it, when the payload exits. `--die-with-parent` makes each bwrap process
 * die with its parent, so SIGKILL to the host tears the sandbox down.
 *
 * The outer bwrap has no signal handlers. A SIGTERM sent to it ends it at
 * once, and the init and payload then die from the parent-death signal
 * without any chance to shut down. A supervisor stopping the host expects
 * the payload to receive the signal, so delivery goes to the payload: the
 * oldest child of the init, which bwrap reports to `--info-fd` as `child-pid`.
 *
 * Until the init is known, or while it has no child yet, nothing has started
 * that could shut down gracefully, so the signal goes to bwrap and tears the
 * sandbox down. A signal that finds the payload already gone is dropped:
 * the launcher is about to report the payload's own exit status.
 *
 * A payload may receive SIGTERM and still not exit. An ACP agent whose client
 * has gone is tearing down its connection when a SIGTERM arrives, consumes it
 * in a handler that only closes the already closed input, and keeps running;
 * the same signal sent again after the teardown ended it at once. The launcher
 * forwards each signal once, so it bounds a termination request itself:
 * SIGTERM and SIGHUP start a grace period of {@link BWRAP_STOP_GRACE_MS}, and
 * when bwrap is still running at its end, SIGKILL to bwrap makes the init die
 * from its parent-death signal and the kernel kills every process left in the
 * PID namespace. SIGINT starts no timer, because an interactive CLI handles it
 * as "cancel the current work" and keeps running.
 */
export function createBwrapSignalDelivery(
  bwrap: ChildProcess,
  info: Readable,
  options: BwrapSignalDeliveryOptions = {},
): (signal: NodeJS.Signals) => void {
  const stopGraceMs = options.stopGraceMs ?? BWRAP_STOP_GRACE_MS;
  let initPid: number | undefined;
  let received = '';
  let killTimer: NodeJS.Timeout | undefined;
  // The timer must not outlive bwrap: once it has exited the sandbox is gone.
  bwrap.once('exit', () => clearTimeout(killTimer));
  info.setEncoding('utf8');
  info.on('data', (chunk: string) => {
    received += chunk;
    initPid ??= parseChildPid(received);
  });
  // A broken info pipe only means the init stays unknown.
  info.on('error', () => {});
  const deliver = (signal: NodeJS.Signals): void => {
    const payload = initPid === undefined ? undefined : oldestChildOf(initPid);
    if (payload === undefined) {
      bwrap.kill(signal);
      return;
    }
    try {
      process.kill(payload, signal);
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
      ) {
        bwrap.kill(signal);
      }
    }
  };
  return (signal) => {
    deliver(signal);
    if (
      TERMINATION_SIGNALS.has(signal) &&
      killTimer === undefined &&
      bwrap.exitCode === null &&
      bwrap.signalCode === null
    ) {
      killTimer = setTimeout(() => bwrap.kill('SIGKILL'), stopGraceMs);
    }
  };
}

function parseChildPid(info: string): number | undefined {
  try {
    const parsed: unknown = JSON.parse(info);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'child-pid' in parsed
    ) {
      const pid = parsed['child-pid'];
      return typeof pid === 'number' && Number.isInteger(pid) ? pid : undefined;
    }
  } catch {
    // The report is not complete yet.
  }
  return undefined;
}

function oldestChildOf(pid: number): number | undefined {
  try {
    const children = fs
      .readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
      .trim();
    const oldest = Number.parseInt(children.split(/\s+/)[0], 10);
    return Number.isInteger(oldest) ? oldest : undefined;
  } catch {
    return undefined;
  }
}
