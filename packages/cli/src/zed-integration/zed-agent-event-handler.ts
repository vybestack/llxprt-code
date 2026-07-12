/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type * as acp from '@agentclientprotocol/sdk';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import {
  extractThoughtText,
  mapDoneReasonToStopReason,
  translateErrorEvent,
  translateIdleTimeout,
} from './zed-helpers.js';
import type { StreamBatcher } from './zed-stream-batcher.js';
import {
  emitToolCallStart,
  emitToolResult,
  emitToolStatus,
} from './zed-tool-handler.js';

interface AgentEventHandlers {
  sendUpdate(update: acp.SessionUpdate): Promise<void>;
  sendUsage(
    usage: Extract<AgentEvent, { type: 'usage' }>['usage'],
  ): Promise<void>;
  handleConfirmation(
    event: Extract<AgentEvent, { type: 'tool-confirmation' }>,
  ): Promise<void>;
}

export async function handleZedAgentEvent(
  event: AgentEvent,
  batcher: StreamBatcher,
  handlers: AgentEventHandlers,
): Promise<acp.StopReason | null> {
  switch (event.type) {
    case 'text':
      batcher.append(event.text, false);
      return null;
    case 'thinking': {
      const thoughtText = extractThoughtText(event.thought);
      if (thoughtText.length > 0) batcher.append(thoughtText, true);
      return null;
    }
    case 'tool-call':
      await batcher.flush();
      await emitToolCallStart(event.call, handlers.sendUpdate);
      return null;
    case 'tool-status':
      await batcher.flush();
      await emitToolStatus(event.update, handlers.sendUpdate);
      return null;
    case 'tool-result':
      await batcher.flush();
      await emitToolResult(event.result, handlers.sendUpdate);
      return null;
    case 'tool-confirmation':
      await batcher.flush();
      await handlers.handleConfirmation(event);
      return null;
    case 'done':
      await batcher.flush();
      return mapDoneReasonToStopReason(event.reason);
    case 'error':
      await batcher.flush();
      throw translateErrorEvent(event);
    case 'idle-timeout':
      await batcher.flush();
      throw translateIdleTimeout(event);
    case 'invalid-stream':
      await batcher.flush();
      throw new Error(
        'Agent produced an invalid stream that could not be recovered.',
      );
    case 'hook-blocked':
      await batcher.flush();
      throw new Error(
        event.info.systemMessage ?? 'Agent stopped by a hook blocker.',
      );
    case 'loop-detected':
      await batcher.flush();
      return 'end_turn';
    case 'notice':
      await batcher.flush();
      await handlers.sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: event.message },
      });
      return null;
    case 'usage':
      await batcher.flush();
      await handlers.sendUsage(event.usage);
      return null;
    case 'context-warning':
    case 'compression':
    case 'model-info':
    case 'retry':
    case 'citation':
      return null;
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled agent event: ${String(exhaustive)}`);
    }
  }
}
