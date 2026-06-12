/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentTerminateMode } from './types.js';

/** Whether the given max_turns value represents a real, positive limit. */
function hasMaxTurnsLimit(maxTurns: number | undefined): maxTurns is number {
  return (
    typeof maxTurns === 'number' && maxTurns > 0 && !Number.isNaN(maxTurns)
  );
}

/**
 * Checks if the agent should terminate due to exceeding configured limits.
 *
 * @param runConfig The run configuration with max_turns and max_time_minutes.
 * @param startTime The timestamp (ms) when execution started.
 * @param turnCounter The current turn number.
 * @param recoveryDeadlineMs If in a recovery turn, the absolute deadline (ms)
 *   that overrides the normal max_time_minutes timeout. When provided, the
 *   max_turns limit is also bypassed since recovery turns are exempt from turn
 *   counting. Pass `undefined` when not in recovery mode.
 * @returns The reason for termination, or `null` if execution can continue.
 */
export function checkAgentTermination(
  runConfig: { max_turns?: number; max_time_minutes: number },
  startTime: number,
  turnCounter: number,
  recoveryDeadlineMs?: number,
): AgentTerminateMode | null {
  const inRecovery = recoveryDeadlineMs !== undefined;

  if (
    !inRecovery &&
    hasMaxTurnsLimit(runConfig.max_turns) &&
    turnCounter >= runConfig.max_turns
  ) {
    return AgentTerminateMode.MAX_TURNS;
  }

  const now = Date.now();

  if (inRecovery) {
    if (now >= recoveryDeadlineMs) {
      return AgentTerminateMode.TIMEOUT;
    }
  } else {
    const elapsedMinutes = (now - startTime) / (1000 * 60);
    if (elapsedMinutes >= runConfig.max_time_minutes) {
      return AgentTerminateMode.TIMEOUT;
    }
  }

  return null;
}
