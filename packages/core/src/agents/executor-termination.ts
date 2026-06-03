/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentTerminateMode } from './types.js';

/**
 * Checks if the agent should terminate due to exceeding configured limits.
 *
 * @returns The reason for termination, or `null` if execution can continue.
 */
export function checkAgentTermination(
  runConfig: { max_turns?: number; max_time_minutes: number },
  startTime: number,
  turnCounter: number,
): AgentTerminateMode | null {
  // Preserve old truthiness semantics: max_turns: 0 must NOT terminate.
  // Use explicit nonzero/non-NaN numeric check to satisfy strict-boolean.
  if (
    typeof runConfig.max_turns === 'number' &&
    runConfig.max_turns > 0 &&
    !Number.isNaN(runConfig.max_turns) &&
    turnCounter >= runConfig.max_turns
  ) {
    return AgentTerminateMode.MAX_TURNS;
  }

  const elapsedMinutes = (Date.now() - startTime) / (1000 * 60);
  if (elapsedMinutes >= runConfig.max_time_minutes) {
    return AgentTerminateMode.TIMEOUT;
  }

  return null;
}
