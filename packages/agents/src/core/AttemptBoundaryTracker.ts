/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentEventType, type ServerAgentStreamEvent } from './turn.js';

/**
 * Decides where the orchestrator tells consumers that a later attempt's
 * output begins (issue #3840).
 *
 * One prompt can run several model attempts (task-list continuation, thinking-only
 * re-prompts). Their events share one stream, so a consumer cannot tell where
 * the next attempt starts. This tracker owns that knowledge and yields an
 * `AttemptBoundary` event immediately before the first output-producing event
 * (non-empty Content, a Thought, or a ToolCallRequest) of every attempt that
 * follows an attempt which produced any such event. Whether a separator is
 * actually needed (something already shown, not already at a paragraph break)
 * depends on what the consumer displays, so the consumer decides; the tracker
 * only reports attempt starts.
 *
 * The scope is one `sendMessageStream` call: a tool-response follow-up starts
 * a new call and a new tracker, so an ordinary tool call, tool result, answer
 * chain is never separated.
 *
 * The boundary is a presentation signal. It is produced from the stream only,
 * never from or into conversation history, so the provider request and the
 * session recording are unaffected.
 */
export class AttemptBoundaryTracker {
  #earlierAttemptProducedOutput = false;
  #currentAttemptProducedOutput = false;
  #boundaryDue = false;

  /** Call when an attempt is about to run. */
  beginAttempt(): void {
    this.#currentAttemptProducedOutput = false;
    this.#boundaryDue = this.#earlierAttemptProducedOutput;
  }

  /**
   * Call for each event of the running attempt, before it is yielded. Returns
   * the boundary event to yield first, or undefined.
   */
  boundaryBefore(
    event: ServerAgentStreamEvent,
  ): ServerAgentStreamEvent | undefined {
    if (!producesOutput(event)) {
      return undefined;
    }
    this.#currentAttemptProducedOutput = true;
    if (!this.#boundaryDue) {
      return undefined;
    }
    this.#boundaryDue = false;
    return { type: AgentEventType.AttemptBoundary };
  }

  /**
   * Call when a transport retry abandons the running attempt. Output of the
   * abandoned attempt no longer counts, and the replacement attempt is still
   * a later attempt of the same earlier output.
   */
  discardAttempt(): void {
    this.#currentAttemptProducedOutput = false;
    this.#boundaryDue = this.#earlierAttemptProducedOutput;
  }

  /** Call when an attempt finished. */
  endAttempt(): void {
    this.#earlierAttemptProducedOutput ||= this.#currentAttemptProducedOutput;
  }
}

function producesOutput(event: ServerAgentStreamEvent): boolean {
  switch (event.type) {
    case AgentEventType.Content:
      return event.value !== '';
    case AgentEventType.Thought:
    case AgentEventType.ToolCallRequest:
      return true;
    default:
      return false;
  }
}
