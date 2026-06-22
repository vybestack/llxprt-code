/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Recovery turn logic for the agent executor.
 *
 * When a subagent hits TIMEOUT, MAX_TURNS, or a protocol violation
 * (no-tool-call / ERROR_NO_COMPLETE_TASK_CALL), it gets exactly one
 * recovery turn with a configurable grace period (default 60 s).
 * The recovery turn prompts the subagent to call `complete_task` with
 * whatever partial result it has.
 *
 * If the subagent calls `complete_task` during recovery → GOAL (success).
 * If it does anything else (calls another tool, stops again) → the
 * original termination reason is preserved and the loop ends immediately.
 */

import type { Content, FunctionCall } from '@google/genai';
import { AgentTerminateMode, type SubagentActivityEventType } from './types.js';

/** Tool name used to signal task completion. */
export const TASK_COMPLETE_TOOL_NAME = 'complete_task';

/** Default grace period (seconds) for the recovery turn. */
export const DEFAULT_GRACE_PERIOD_SECONDS = 60;

/**
 * Resolve the grace period from the configured value, falling back to the
 * default when the value is missing, zero, negative, NaN, or Infinity.
 */
export function resolveGracePeriodSeconds(
  configured: number | undefined,
): number {
  if (
    typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return configured;
  }
  return DEFAULT_GRACE_PERIOD_SECONDS;
}

// ---------------------------------------------------------------------------
// Discriminated-union recovery state
// ---------------------------------------------------------------------------

/** Not currently in recovery mode. */
export interface RecoveryNone {
  readonly phase: 'none';
}

/** Currently in recovery mode – exactly one more model response is allowed. */
export interface RecoveryActive {
  readonly phase: 'active';
  readonly originalReason: AgentTerminateMode;
  readonly deadlineMs: number;
  readonly gracePeriodSeconds: number;
}

/** Recovery state: either `none` or `active`. */
export type RecoveryState = RecoveryNone | RecoveryActive;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether a termination reason is eligible for a recovery turn.
 *
 * Only TIMEOUT, MAX_TURNS, and ERROR_NO_COMPLETE_TASK_CALL trigger
 * recovery.  ABORTED and generic ERROR do not.
 */
export function isRecoverableTermination(
  reason: AgentTerminateMode,
): reason is
  | AgentTerminateMode.TIMEOUT
  | AgentTerminateMode.MAX_TURNS
  | AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL {
  return (
    reason === AgentTerminateMode.TIMEOUT ||
    reason === AgentTerminateMode.MAX_TURNS ||
    reason === AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL
  );
}

/** Mark the recovery model response as used (idempotent). */
export function markRecoveryResponseUsed(
  recoveryState: RecoveryState,
  previouslyUsed: boolean,
): boolean {
  return previouslyUsed || recoveryState.phase === 'active';
}

/**
 * Build the warning `Content` message sent to the model at the start of a
 * recovery turn, instructing it to call `complete_task` immediately.
 */
export function getRecoveryWarningMessage(reason: AgentTerminateMode): Content {
  const isProtocolViolation =
    reason === AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL;

  const prefix = isProtocolViolation
    ? 'WARNING: You stopped calling tools without calling `' +
      TASK_COMPLETE_TOOL_NAME +
      '` to finalize the session.'
    : 'WARNING: You have reached an execution limit (' + reason + ').';

  const suffix =
    ' You have ONE final chance to wrap up. You must immediately call the `' +
    TASK_COMPLETE_TOOL_NAME +
    '` tool with the best partial answer you can provide. Explain that the investigation was interrupted. Do NOT call any other tools. This is your final turn.';

  return {
    role: 'user',
    parts: [{ text: prefix + suffix }],
  };
}

/**
 * Enter recovery mode: compute the deadline, emit telemetry, return the
 * new `RecoveryState` and warning message.
 */
export function enterRecovery(
  reason: AgentTerminateMode,
  gracePeriodSeconds: number,
  emitActivity: (
    type: SubagentActivityEventType,
    data: Record<string, unknown>,
  ) => void,
): { state: RecoveryActive; warningMessage: Content } {
  const deadlineMs = Date.now() + gracePeriodSeconds * 1000;

  emitActivity('THOUGHT_CHUNK', {
    text: `Execution limit reached (${reason}). Attempting one final recovery turn with a grace period.`,
  });
  emitActivity('RECOVERY_ATTEMPT', {
    originalReason: reason,
    gracePeriodSeconds,
  });

  const state: RecoveryActive = {
    phase: 'active',
    originalReason: reason,
    deadlineMs,
    gracePeriodSeconds,
  };

  return { state, warningMessage: getRecoveryWarningMessage(reason) };
}

/**
 * Build the failure result object returned when recovery does not
 * succeed (the subagent failed to call `complete_task`).
 *
 * @param originalReason  The termination reason that originally triggered recovery.
 * @param partialResult    Any partial result accumulated before recovery, or `null`.
 */
export function recoveryFailureResult(
  originalReason: AgentTerminateMode,
  partialResult: string | null,
): {
  terminateReason: AgentTerminateMode;
  finalResult: string;
} {
  const isProtocolViolation =
    originalReason === AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL;

  const suffix = isProtocolViolation
    ? "still did not call '" +
      TASK_COMPLETE_TOOL_NAME +
      "'. Original reason: " +
      String(originalReason) +
      '.'
    : 'failed. Original reason: ' + String(originalReason) + '.';
  const failureMessage = 'Recovery turn attempted but agent ' + suffix;

  return {
    terminateReason: originalReason,
    finalResult:
      partialResult === null
        ? failureMessage
        : failureMessage +
          '\n\nPartial result before recovery:\n' +
          partialResult,
  };
}

/**
 * Callback for emitting activity events during recovery checks.
 */
export type EmitActivityFn = (
  type: SubagentActivityEventType,
  data: Record<string, unknown>,
) => void;

/** Emit a RECOVERY_OUTCOME telemetry event. */
function emitRecoveryOutcome(
  emitActivity: EmitActivityFn,
  originalReason: AgentTerminateMode,
  outcome: 'success' | 'failure',
  terminateReason: AgentTerminateMode,
  gracePeriodSeconds: number,
): void {
  emitActivity('RECOVERY_OUTCOME', {
    originalReason,
    outcome,
    terminateReason,
    gracePeriodSeconds,
  });
}

/**
 * Check tool calls during recovery: non-complete_task = recovery failure.
 *
 * Returns a failure result if the model (during its one recovery response)
 * did not call `complete_task`, or called other tools alongside it.
 * Returns `null` if recovery is not active, the response hasn't been used,
 * or the calls are valid (exactly one `complete_task`).
 */
export function checkRecoveryToolCalls(
  recoveryState: RecoveryState,
  recoveryModelResponseUsed: boolean,
  functionCalls: FunctionCall[],
  finalResult: string | null,
  emitActivity: EmitActivityFn,
): { terminateReason: AgentTerminateMode; finalResult: string } | null {
  if (recoveryState.phase !== 'active' || !recoveryModelResponseUsed) {
    return null;
  }
  const hasCompleteTask = functionCalls.some(
    (fc) => fc.name === TASK_COMPLETE_TOOL_NAME,
  );
  if (!hasCompleteTask) {
    emitRecoveryOutcome(
      emitActivity,
      recoveryState.originalReason,
      'failure',
      recoveryState.originalReason,
      recoveryState.gracePeriodSeconds,
    );
    return recoveryFailureResult(recoveryState.originalReason, finalResult);
  }

  // Recovery response must be exactly one complete_task call.
  // If complete_task is accompanied by other tools, fail recovery immediately
  // and do not execute any of the tool calls.
  if (functionCalls.length > 1) {
    emitRecoveryOutcome(
      emitActivity,
      recoveryState.originalReason,
      'failure',
      recoveryState.originalReason,
      recoveryState.gracePeriodSeconds,
    );
    return recoveryFailureResult(recoveryState.originalReason, finalResult);
  }

  return null;
}

/** Result when a termination reason is handled (either enter recovery or finish). */
export type TerminationHandlingResult =
  | { handled: true; newState: RecoveryActive; currentMessage: Content }
  | {
      handled: false;
      result: {
        terminateReason: AgentTerminateMode;
        finalResult: string | null;
      };
    };

/**
 * Handle termination-reason checks: enter recovery or return immediately.
 *
 * If the reason is recoverable and we're not already in recovery, enter
 * recovery. If already in recovery, the second termination means recovery
 * failed. Otherwise return the plain termination result.
 */
export function handleTerminationReason(
  reason: AgentTerminateMode,
  recoveryState: RecoveryState,
  finalResult: string | null,
  gracePeriodSeconds: number,
  emitActivity: EmitActivityFn,
): TerminationHandlingResult {
  if (isRecoverableTermination(reason) && recoveryState.phase === 'none') {
    const { state, warningMessage } = enterRecovery(
      reason,
      gracePeriodSeconds,
      emitActivity,
    );
    return { handled: true, newState: state, currentMessage: warningMessage };
  }

  if (recoveryState.phase === 'active') {
    const fail = recoveryFailureResult(
      recoveryState.originalReason,
      finalResult,
    );
    emitRecoveryOutcome(
      emitActivity,
      recoveryState.originalReason,
      'failure',
      fail.terminateReason,
      recoveryState.gracePeriodSeconds,
    );
    return { handled: false, result: fail };
  }

  return { handled: false, result: { terminateReason: reason, finalResult } };
}

/** Result when a protocol violation is handled. */
export type ProtocolViolationResult =
  | { entered: true; state: RecoveryActive; warningMessage: Content }
  | {
      entered: false;
      result: { terminateReason: AgentTerminateMode; finalResult: string };
    };

/**
 * Handle the protocol-violation path (model stopped calling tools).
 *
 * If not already in recovery, enter recovery for a protocol violation.
 * If already in recovery, the empty response confirms recovery failure.
 */
export function handleProtocolViolation(
  recoveryState: RecoveryState,
  finalResult: string | null,
  gracePeriodSeconds: number,
  emitActivity: EmitActivityFn,
): ProtocolViolationResult {
  if (recoveryState.phase === 'none') {
    const { state, warningMessage } = enterRecovery(
      AgentTerminateMode.ERROR_NO_COMPLETE_TASK_CALL,
      gracePeriodSeconds,
      emitActivity,
    );
    return { entered: true, state, warningMessage };
  }

  // Already in recovery: the one recovery model response didn't call
  // complete_task, so this empty response confirms recovery failure.
  const fail = recoveryFailureResult(recoveryState.originalReason, finalResult);
  return { entered: false, result: fail };
}
