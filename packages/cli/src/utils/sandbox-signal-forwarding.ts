/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ChildProcess } from 'node:child_process';

/**
 * Signals a supervisor sends to stop a process it started. The sandbox hop
 * runs the CLI as a child (`sandbox-exec`, `docker run` or `podman run`), so
 * the host receives these on behalf of the sandboxed CLI. Mirrors the set the
 * Bun launcher forwards, minus the Windows-only SIGBREAK.
 */
export const FORWARDED_SANDBOX_SIGNALS: readonly NodeJS.Signals[] = [
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
];

/**
 * Relays termination signals received by the host to the sandbox child so
 * that stopping the host stops the sandboxed CLI instead of orphaning it.
 *
 * Installing a handler suspends the default "die now" action, so the host
 * keeps waiting for the child's `close` and then exits with the child's
 * status (the caller maps a signal death to 128+signal). Each signal is
 * forwarded as it arrives, so a repeated signal reaches the child again. This
 * function adds no SIGKILL escalation, matching the Bun launcher; SIGKILL to
 * the host remains the unconditional stop, and an engine that must bound the
 * shutdown (bwrap) does it inside `deliver`.
 *
 * `deliver` chooses where a signal goes. It defaults to the child itself; an
 * engine whose child is a launcher that would die on the signal instead of
 * relaying it (bwrap) supplies a function that reaches the real payload.
 *
 * Handlers are removed when the child closes. Returns a function that removes
 * them earlier.
 */
export function forwardSignalsToSandboxProcess(
  sandboxProcess: ChildProcess,
  deliver: (signal: NodeJS.Signals) => void = (signal) => {
    sandboxProcess.kill(signal);
  },
): () => void {
  const forward = (signal: NodeJS.Signals): void => {
    if (
      sandboxProcess.exitCode === null &&
      sandboxProcess.signalCode === null
    ) {
      deliver(signal);
    }
  };
  const stop = (): void => {
    for (const signal of FORWARDED_SANDBOX_SIGNALS) {
      process.off(signal, forward);
    }
    sandboxProcess.off('close', stop);
    sandboxProcess.off('error', onError);
  };
  // A spawn failure reports 'error' without a live child to signal. Any later
  // 'error' (a failed kill) leaves the child running and the handlers needed.
  const onError = (): void => {
    if (sandboxProcess.pid === undefined) stop();
  };
  for (const signal of FORWARDED_SANDBOX_SIGNALS) {
    process.on(signal, forward);
  }
  sandboxProcess.on('close', stop);
  sandboxProcess.on('error', onError);
  return stop;
}
