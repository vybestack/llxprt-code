/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter } from 'node:events';
import type { ShellProcessIdentity } from './shellJobTypes.js';
import type { ShellJobState, TerminalDetails } from './shellJobTypes.js';
import type { ShellJobRecord } from './shellJobTypes.js';
import { toPublicJob } from './shellJobTypes.js';
import { isKillablePid } from './shellProcessKill.js';
import { TerminalTransitionGuard } from './shellJobTransition.js';

/**
 * Internal bookkeeping for a single shell job: the record, the exactly-once
 * guard, the terminal promise (resolved when the job reaches a terminal
 * state), and the event emission helper.
 */
export interface ShellJobContext {
  record: ShellJobRecord;
  guard: TerminalTransitionGuard;
  emitter: EventEmitter;
}

/**
 * Apply a terminal transition to a job context. This is the single funnel
 * point: every path (exit, error, cancel, log-cap breach, dispose) calls this.
 * If the guard has already fired, this is a no-op returning false.
 *
 * On success, the record is updated and the terminal promise is resolved.
 * The manager completes resource bookkeeping before delivering notifications.
 */
export function applyTerminal(
  ctx: ShellJobContext,
  state: ShellJobState,
  details: TerminalDetails,
): boolean {
  if (!ctx.guard.attempt()) {
    return false;
  }

  const { record } = ctx;
  record.state = state;
  record.phase = null;
  record.endedAt = Date.now();
  if (details.exitCode !== undefined) {
    record.exitCode = details.exitCode;
  }
  if (details.signal !== undefined) {
    record.signal = details.signal;
  }
  if (details.failureReason !== undefined) {
    record.failureReason = details.failureReason;
  }

  if (record.escalateTimer !== undefined) {
    clearTimeout(record.escalateTimer);
    record.escalateTimer = undefined;
  }

  record.resolveTerminal();
  return true;
}

export function emitTerminalEvent(
  ctx: ShellJobContext,
  state: ShellJobState,
): unknown[] {
  if (state === 'running') return [];
  const job = toPublicJob(ctx.record);
  const errors: unknown[] = [];
  for (const listener of ctx.emitter.rawListeners(`job-${state}`)) {
    try {
      listener.call(ctx.emitter, job);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

/**
 * Create the internal context for a new job.
 */
export function createJobContext(
  record: ShellJobRecord,
  emitter: EventEmitter,
): ShellJobContext {
  return {
    record,
    guard: new TerminalTransitionGuard(),
    emitter,
  };
}

export function childIsRunning(child: ShellProcessIdentity): boolean {
  return !child.killed && child.exitCode === null && child.signalCode === null;
}

export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killProcessGroupSafe(
  pid: number | undefined,
  signal: NodeJS.Signals,
): void {
  // pid 0 would collapse to process.kill(0), signalling the caller's own
  // process group. A non-killable pid is a silent no-op.
  if (!isKillablePid(pid)) {
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // Process may already be gone — sanctioned catch.
  }
}

export function readJobState(record: ShellJobRecord): ShellJobState {
  return record.state;
}
