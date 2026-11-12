/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  StreamEventType,
  type StreamEvent,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import {
  AgentExecutionBlockedError,
  AgentExecutionStoppedError,
} from './chatSession.js';

/**
 * Yields the stream events that report a hook's stop or block decision.
 * Returns true when `error` was such a decision (the attempt then ends
 * without an error), false for any other failure.
 */
export function* hookControlStreamEvents(
  error: unknown,
): Generator<StreamEvent, boolean> {
  if (error instanceof AgentExecutionStoppedError) {
    yield {
      type: StreamEventType.AGENT_EXECUTION_STOPPED,
      reason: error.reason,
      systemMessage: error.systemMessage,
      contextCleared: error.contextCleared,
    };
    return true;
  }
  if (error instanceof AgentExecutionBlockedError) {
    yield {
      type: StreamEventType.AGENT_EXECUTION_BLOCKED,
      reason: error.reason,
      systemMessage: error.systemMessage,
      contextCleared: error.contextCleared,
    };
    if (error.blockedOutput) {
      // P13: blockedOutput is now a neutral ModelOutput (was syntheticResponse).
      yield { type: StreamEventType.CHUNK, value: error.blockedOutput };
    }
    return true;
  }
  return false;
}
