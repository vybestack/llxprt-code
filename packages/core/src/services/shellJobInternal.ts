/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ShellJobState, TerminalDetails } from './shellJobTypes.js';
import type { ShellJobRecord } from './shellJobTypes.js';
import { toPublicJob } from './shellJobTypes.js';
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
 * On success, the record is updated, the event is emitted, and the terminal
 * promise is resolved.
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

  emitTerminalEvent(ctx, state);
  record.resolveTerminal();
  return true;
}

function emitTerminalEvent(ctx: ShellJobContext, state: ShellJobState): void {
  const job = toPublicJob(ctx.record);
  switch (state) {
    case 'completed':
      ctx.emitter.emit('job-completed', job);
      break;
    case 'failed':
      ctx.emitter.emit('job-failed', job);
      break;
    case 'cancelled':
      ctx.emitter.emit('job-cancelled', job);
      break;
    default:
      break;
  }
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

export function childIsRunning(child: ChildProcess): boolean {
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
  pid: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Process may already be gone — sanctioned catch.
  }
}

export function readJobState(record: ShellJobRecord): ShellJobState {
  return record.state;
}
