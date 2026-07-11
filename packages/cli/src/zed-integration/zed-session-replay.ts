/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * IContent -> ACP SessionUpdate mapping for ACP session/load (loadSession)
 * conversation replay (issue #1604).
 *
 * When Zed calls `session/load`, the agent resumes a persisted session and must
 * stream the historical conversation back to the client as `session/update`
 * notifications BEFORE the load resolves, so the client can reconstruct the
 * transcript. This module owns the pure, side-effect-free translation from the
 * neutral {@link IContent} history (as returned by `agent.session.resume`) to
 * the ordered list of ACP {@link acp.SessionUpdate} notifications the live
 * streaming path (StreamBatcher / zed-tool-handler.ts) would have produced.
 *
 * It is kept separate from zedIntegration.ts (and free of any I/O) so the
 * mapping stays small, individually unit-testable against the v1 snake_case
 * wire discriminators, and lint-clean under the complexity guardrails.
 */

import type * as acp from '@agentclientprotocol/sdk';
import type {
  IContent,
  ContentBlock,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core';
import { inferToolKind } from './zed-tool-handler.js';
import { extractToolResultText } from './zed-content-utils.js';

/**
 * Maps a full resumed history (ordered IContent[]) to the ordered ACP
 * SessionUpdate notifications that replay the conversation. Empty/whitespace
 * text chunks are skipped; unmappable blocks (media, code, empty tool text)
 * contribute no update. The output order preserves the history order and, per
 * message, the block order — matching how the live path emits chunks.
 */
export function mapHistoryToSessionUpdates(
  items: readonly IContent[],
): acp.SessionUpdate[] {
  const updates: acp.SessionUpdate[] = [];
  for (const item of items) {
    appendMessageUpdates(item, updates);
  }
  return updates;
}

/**
 * Appends the SessionUpdates for a single IContent message, dispatching on the
 * speaker so each block is mapped by the rules for that role.
 */
function appendMessageUpdates(item: IContent, out: acp.SessionUpdate[]): void {
  for (const block of item.blocks) {
    const update = mapBlock(item.speaker, block);
    if (update !== null) {
      out.push(update);
    }
  }
}

/**
 * Maps a single (speaker, block) pair to at most one SessionUpdate, or null when
 * the block has no faithful replay representation (empty text, media/code, a
 * human-authored non-text block, etc.).
 */
function mapBlock(
  speaker: IContent['speaker'],
  block: ContentBlock,
): acp.SessionUpdate | null {
  switch (block.type) {
    case 'text':
      return mapTextBlock(speaker, block);
    case 'thinking':
      return mapThinkingBlock(speaker, block);
    case 'tool_call':
      return speaker === 'ai' ? mapToolCallBlock(block) : null;
    case 'tool_response':
      return speaker === 'tool' ? mapToolResponseBlock(block) : null;
    // Media/code blocks are intentionally skipped in v1 replay: ACP has no
    // lossless chunk for a stored CodeBlock, and re-streaming base64 MediaBlock
    // payloads on every reconnect would be wasteful and is not required to
    // reconstruct the readable transcript.
    default:
      return null;
  }
}

/**
 * human text -> user_message_chunk; ai text -> agent_message_chunk. Tool-speaker
 * text (rare) is skipped. Whitespace-only text is skipped.
 */
function mapTextBlock(
  speaker: IContent['speaker'],
  block: TextBlock,
): acp.SessionUpdate | null {
  const text = block.text;
  if (text.trim().length === 0) {
    return null;
  }
  if (speaker === 'human') {
    return {
      sessionUpdate: 'user_message_chunk',
      content: { type: 'text', text },
    };
  }
  if (speaker === 'ai') {
    return {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    };
  }
  return null;
}

/**
 * ai thinking -> agent_thought_chunk (text content carrying the thought). Empty
 * thoughts, or thinking blocks from a non-ai speaker, are skipped.
 */
function mapThinkingBlock(
  speaker: IContent['speaker'],
  block: ThinkingBlock,
): acp.SessionUpdate | null {
  if (speaker !== 'ai') {
    return null;
  }
  const text = block.thought;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }
  return {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text },
  };
}

/**
 * ai tool_call -> tool_call update (status 'completed', since a stored history
 * block represents a call that already ran). Field names mirror the live start
 * path in zed-tool-handler.ts (toolCallId/title/kind/rawInput); kind is inferred
 * from the tool name via the SAME TOOL_KIND_BY_NAME table.
 */
function mapToolCallBlock(block: ToolCallBlock): acp.SessionUpdate {
  const kind = inferToolKind(block.name);
  return {
    sessionUpdate: 'tool_call',
    toolCallId: block.id,
    title: block.name,
    status: 'completed',
    ...(kind !== undefined ? { kind } : {}),
    rawInput: toRawInput(block.parameters),
  };
}

/**
 * tool tool_response -> tool_call_update (status 'completed'). When the stored
 * result renders to non-empty text (via the SAME extractToolResultText helper
 * the live tool path uses), it is included as a single text ToolCallContent;
 * otherwise the update carries an empty content array (mirroring the live
 * suppressed-display behavior).
 */
function mapToolResponseBlock(block: ToolResponseBlock): acp.SessionUpdate {
  const text = extractToolResultText({ llmContent: block.result });
  const content: acp.ToolCallContent[] =
    text !== null && text.length > 0
      ? [{ type: 'content', content: { type: 'text', text } }]
      : [];
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: block.callId,
    status: 'completed',
    content,
  };
}

/**
 * Narrows a stored ToolCallBlock.parameters (typed `unknown`) to the `rawInput`
 * shape ACP expects: a JSON object, or undefined when the stored value is not a
 * plain object (so the wire payload never carries a non-object rawInput).
 */
function toRawInput(
  parameters: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (
    parameters !== null &&
    typeof parameters === 'object' &&
    !Array.isArray(parameters)
  ) {
    return parameters as Readonly<Record<string, unknown>>;
  }
  return undefined;
}
