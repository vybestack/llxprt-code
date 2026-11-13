/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isRefusalFinishEvent } from '../refusal/refusalDetection.js';
import { AgentEventType, type ServerAgentStreamEvent } from './turn.js';

/**
 * Mutable per-attempt accumulators owned by `_processStreamIteration`. Held in
 * a single record so a transport Retry can reset them by reference.
 */
export interface AttemptState {
  hadThinking: boolean;
  hadContent: boolean;
  hadToolCallsThisTurn: boolean;
  /** The attempt ended with a refusal (issue #4036). */
  refused: boolean;
}

export function recordAttemptActivity(
  event: ServerAgentStreamEvent,
  state: AttemptState,
): void {
  if (event.type === AgentEventType.ToolCallRequest)
    state.hadToolCallsThisTurn = true;
  if (event.type === AgentEventType.Thought) state.hadThinking = true;
  if (event.type === AgentEventType.Content) state.hadContent = true;
  state.refused ||= isRefusalFinishEvent(event);
}
