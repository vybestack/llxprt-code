/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ShellJobState, TerminalDetails } from './shellJobTypes.js';

/**
 * TerminalTransitionGuard ensures that a job transitions to a terminal state
 * exactly once. Every path (exit, error, cancel, log-cap breach, dispose)
 * funnels through attemptTerminal(). If the job is already terminal, the call
 * is a no-op and returns false.
 *
 * Cancel wins a race with exit: if cancel is accepted (sets phase to
 * 'cancelling') before exit fires, cancelled is the terminal state. If exit
 * fires before cancel is accepted, cancel() returns false.
 */
export class TerminalTransitionGuard {
  private terminal: boolean = false;

  get isTerminal(): boolean {
    return this.terminal;
  }

  /**
   * Attempt a terminal transition. Returns true if this call won (the first
   * terminal transition), false if the job was already terminal.
   */
  attempt(): boolean {
    if (this.terminal) {
      return false;
    }
    this.terminal = true;
    return true;
  }
}

/**
 * Resolve the terminal state given the current phase and the proposed state
 * from an exit/error event. Cancel takes priority: if the job is in the
 * 'cancelling' phase, the terminal state is always 'cancelled'.
 */
export function resolveTerminalState(
  isCancelling: boolean,
  proposedState: ShellJobState,
): ShellJobState {
  if (isCancelling) {
    return 'cancelled';
  }
  return proposedState;
}

/**
 * Determine whether an exit code corresponds to success or failure. Code 0
 * (or null with no signal) is completed; anything else is failed.
 */
export function classifyExit(
  exitCode: number | null,
  signal: string | null,
  isCancelling: boolean,
): { state: ShellJobState; details: TerminalDetails } {
  if (isCancelling) {
    return { state: 'cancelled', details: {} };
  }

  const details: TerminalDetails = {};
  if (signal !== null) {
    details.signal = signal;
    return { state: 'failed', details };
  }
  if (exitCode !== null) {
    details.exitCode = exitCode;
    return {
      state: exitCode === 0 ? 'completed' : 'failed',
      details,
    };
  }
  // No exit code and no signal — treat as failure.
  details.failureReason = 'Process exited without an exit code or signal';
  return { state: 'failed', details };
}
