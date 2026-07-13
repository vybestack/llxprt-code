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

/**
 * Flushes pending batched chunks without letting a flush failure replace the
 * original event context. StreamBatcher.flush is designed to never reject
 * (settleChainLink catches), but this guard ensures a future contract change
 * cannot cause an 'error' event to be swallowed or a 'done' stop reason to be
 * dropped by a flush exception.
 */
async function safeFlush(batcher: StreamBatcher): Promise<void> {
  try {
    await batcher.flush();
  } catch {
    // Best-effort: the batcher's internal chain swallows its own errors, so
    // this is a defense-in-depth guard against unexpected rejections.
  }
}

interface AgentEventHandlers {
  sendUpdate(update: acp.SessionUpdate): Promise<void>;
  sendUsage(
    usage: Extract<AgentEvent, { type: 'usage' }>['usage'],
  ): Promise<void>;
  handleConfirmation(
    event: Extract<AgentEvent, { type: 'tool-confirmation' }>,
  ): Promise<void>;
  resolveToolKind(toolName: string): string | undefined;
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
    case 'thinking':
      return handleThinking(event, batcher);
    case 'tool-call':
      return handleToolEvent(event, batcher, handlers);
    case 'tool-status':
      return handleToolUpdate(event, batcher, handlers);
    case 'tool-result':
      return handleToolResultEvent(event, batcher, handlers);
    case 'tool-confirmation':
      await safeFlush(batcher);
      await handlers.handleConfirmation(event);
      return null;
    case 'done':
      await safeFlush(batcher);
      return mapDoneReasonToStopReason(event.reason);
    case 'error':
      await safeFlush(batcher);
      throw translateErrorEvent(event);
    case 'idle-timeout':
      await safeFlush(batcher);
      throw translateIdleTimeout(event);
    case 'invalid-stream':
      await safeFlush(batcher);
      throw new Error(
        'Agent produced an invalid stream that could not be recovered.',
      );
    case 'hook-blocked':
      await safeFlush(batcher);
      throw new Error(
        event.info.systemMessage ?? 'Agent stopped by a hook blocker.',
      );
    case 'loop-detected':
      await safeFlush(batcher);
      return 'end_turn';
    case 'notice':
      return handleNotice(event, batcher, handlers);
    case 'usage':
      await safeFlush(batcher);
      await handlers.sendUsage(event.usage);
      return null;
    case 'context-warning':
    case 'compression':
    case 'model-info':
    case 'retry':
    case 'citation':
      return null;
    default:
      return assertNever(event);
  }
}

function handleThinking(
  event: Extract<AgentEvent, { type: 'thinking' }>,
  batcher: StreamBatcher,
): null {
  const thoughtText = extractThoughtText(event.thought);
  if (thoughtText.length > 0) batcher.append(thoughtText, true);
  return null;
}

async function handleToolEvent(
  event: Extract<AgentEvent, { type: 'tool-call' }>,
  batcher: StreamBatcher,
  handlers: AgentEventHandlers,
): Promise<null> {
  await safeFlush(batcher);
  await emitToolCallStart(
    event.call,
    handlers.sendUpdate,
    handlers.resolveToolKind(event.call.name),
  );
  return null;
}

async function handleToolUpdate(
  event: Extract<AgentEvent, { type: 'tool-status' }>,
  batcher: StreamBatcher,
  handlers: AgentEventHandlers,
): Promise<null> {
  await safeFlush(batcher);
  await emitToolStatus(
    event.update,
    handlers.sendUpdate,
    handlers.resolveToolKind(event.update.name),
  );
  return null;
}

async function handleToolResultEvent(
  event: Extract<AgentEvent, { type: 'tool-result' }>,
  batcher: StreamBatcher,
  handlers: AgentEventHandlers,
): Promise<null> {
  await safeFlush(batcher);
  await emitToolResult(
    event.result,
    handlers.sendUpdate,
    handlers.resolveToolKind(event.result.name),
  );
  return null;
}

async function handleNotice(
  event: Extract<AgentEvent, { type: 'notice' }>,
  batcher: StreamBatcher,
  handlers: AgentEventHandlers,
): Promise<null> {
  await safeFlush(batcher);
  await handlers.sendUpdate({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: event.message },
  });
  return null;
}

function assertNever(event: never): never {
  throw new Error(`Unhandled agent event: ${String(event)}`);
}
