/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AfterAgentHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { ServerAgentStreamEvent } from './turn.js';
import type {
  MessageStreamDeps,
  StreamContext,
} from './MessageStreamOrchestrator.js';

export async function* sendAfterAgentDecision(
  sendMessageStream: MessageStreamDeps['sendMessageStream'],
  ctx: StreamContext,
  afterOut: AfterAgentHookOutput | undefined,
  boundedTurns: number,
): AsyncGenerator<ServerAgentStreamEvent> {
  if (
    afterOut?.isBlockingDecision() === true ||
    afterOut?.shouldStopExecution() === true
  ) {
    yield* sendMessageStream(
      [{ type: 'text', text: afterOut.getEffectiveReason() }],
      ctx.signal,
      ctx.prompt_id,
      boundedTurns - 1,
      false,
      false,
      ctx.recordingExecution,
      ctx.modelParameters,
    );
  }
}
