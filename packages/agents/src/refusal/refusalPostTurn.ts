/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { emitAfterAgentContextClear } from '../core/afterAgentDecisionStream.js';
import type {
  MessageStreamDeps,
  StreamContext,
} from '../core/MessageStreamOrchestrator.js';
import type { ServerAgentStreamEvent } from '../core/turn.js';

/**
 * A refused attempt ends the logical request. The refusal text (if any) was
 * already streamed; nothing here may restart the request: no task-list or
 * thinking-only follow-up and no AfterAgent continuation (issue #4036).
 */
export async function* finishWithRefusal(
  deps: Pick<
    MessageStreamDeps,
    'logger' | 'todoContinuationService' | 'agentHookManager'
  >,
  deferredEvents: ServerAgentStreamEvent[],
  ctx: StreamContext,
): AsyncGenerator<
  ServerAgentStreamEvent,
  { done: true; retryCount: 0; newBaseRequest: undefined }
> {
  deps.logger.debug(
    () => `[stream:orchestrator] ending request after refused attempt`,
    { deferredEventCount: deferredEvents.length },
  );
  for (const d of deferredEvents) yield d;
  deps.todoContinuationService.toolCallReminderLevel = 'none';
  deps.todoContinuationService.toolActivityCount = 0;
  yield* emitAfterAgentContextClear(deps.agentHookManager, ctx);
  return { done: true, retryCount: 0, newBaseRequest: undefined };
}
