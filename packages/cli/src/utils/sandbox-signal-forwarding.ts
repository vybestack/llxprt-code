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
 * forwarded as it arrives, so a repeated signal reaches the child again; there
 * is no SIGKILL escalation, matching the Bun launcher, and SIGKILL to the host
 * remains the unconditional stop.
 *
 * Handlers are removed when the child closes. Returns a function that removes
 * them earlier.
 */
export function forwardSignalsToSandboxProcess(
  sandboxProcess: ChildProcess,
): () => void {
  const forward = (signal: NodeJS.Signals): void => {
    if (
      sandboxProcess.exitCode === null &&
      sandboxProcess.signalCode === null
    ) {
      sandboxProcess.kill(signal);
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
