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
 * Tool-call fidelity: the live path emits a tool_call (status 'in_progress',
 * empty content, inferred locations/kind) at call time and a SEPARATE
 * tool_call_update (completed/failed with the result text) when the response
 * arrives. Replay mirrors that two-update shape so a reconstructed transcript is
 * wire-indistinguishable from a live one: each recorded ai ToolCallBlock emits
 * the in_progress tool_call, and its paired tool ToolResponseBlock emits the
 * terminal tool_call_update. A ToolCallBlock with no recorded response (an
 * interrupted turn) gets a synthetic 'failed' tool_call_update so the client
 * never renders a perpetually-running tool.
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
import { buildToolLocations, inferToolKind } from './zed-tool-handler.js';
import { extractToolResultText } from './zed-content-utils.js';

/** Readonly JSON-object shape used when narrowing recorded `unknown` payloads. */
type Dict = Readonly<Record<string, unknown>>;

/**
 * Maps a full resumed history (ordered IContent[]) to the ordered ACP
 * SessionUpdate notifications that replay the conversation. Empty/whitespace
 * text chunks are skipped; unmappable blocks (media, code) contribute no update.
 * Each ai tool_call contributes an in_progress tool_call PLUS — when the call
 * has no recorded response — a terminal failed tool_call_update; a recorded tool
 * response contributes the matching completed/failed tool_call_update. The
 * output preserves the history order and, per message, the block order.
 */
export function mapHistoryToSessionUpdates(
  items: readonly IContent[],
): acp.SessionUpdate[] {
  const respondedCallIds = collectRespondedCallIds(items);
  const updates: acp.SessionUpdate[] = [];
  for (const item of items) {
    for (const block of item.blocks) {
      appendBlockUpdates(item.speaker, block, respondedCallIds, updates);
    }
  }
  return updates;
}

/**
 * Pre-scans the history for the callIds that DO have a tool ToolResponseBlock,
 * so the block pass can tell a paired tool_call (whose response will emit the
 * terminal update) from an orphaned one (interrupted turn) that needs a
 * synthetic failed update. Kept as a separate pure pass so the per-block mapping
 * stays a simple forward walk.
 */
function collectRespondedCallIds(
  items: readonly IContent[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.speaker !== 'tool') {
      continue;
    }
    for (const block of item.blocks) {
      if (block.type === 'tool_response') {
        ids.add(block.callId);
      }
    }
  }
  return ids;
}

/**
 * Appends the SessionUpdate(s) for a single (speaker, block) pair to `out`. Most
 * blocks map to at most one update; an ai tool_call may append two (the
 * in_progress tool_call and, when orphaned, a terminal failed update).
 */
function appendBlockUpdates(
  speaker: IContent['speaker'],
  block: ContentBlock,
  respondedCallIds: ReadonlySet<string>,
  out: acp.SessionUpdate[],
): void {
  switch (block.type) {
    case 'text':
      pushDefined(out, mapTextBlock(speaker, block));
      return;
    case 'thinking':
      pushDefined(out, mapThinkingBlock(speaker, block));
      return;
    case 'tool_call':
      if (speaker === 'ai') {
        appendToolCallUpdates(block, respondedCallIds, out);
      }
      return;
    case 'tool_response':
      if (speaker === 'tool') {
        out.push(mapToolResponseBlock(block));
      }
      return;
    // Media/code blocks are intentionally skipped in v1 replay: ACP has no
    // lossless chunk for a stored CodeBlock, and re-streaming base64 MediaBlock
    // payloads on every reconnect would be wasteful and is not required to
    // reconstruct the readable transcript.
    default:
      return;
  }
}

/** Pushes `update` onto `out` when it is non-null (small readability helper). */
function pushDefined(
  out: acp.SessionUpdate[],
  update: acp.SessionUpdate | null,
): void {
  if (update !== null) {
    out.push(update);
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
 * Appends the replay updates for an ai ToolCallBlock: first the in_progress
 * tool_call matching the live start shape, then — ONLY when the call has no
 * recorded response — a terminal failed tool_call_update (empty content) so an
 * interrupted turn does not leave a perpetually-running tool on the client. A
 * call WITH a recorded response gets its terminal update from that response
 * block (mapToolResponseBlock), preserving the live "start then complete" pair.
 */
function appendToolCallUpdates(
  block: ToolCallBlock,
  respondedCallIds: ReadonlySet<string>,
  out: acp.SessionUpdate[],
): void {
  out.push(buildToolCallStart(block));
  if (!respondedCallIds.has(block.id)) {
    out.push({
      sessionUpdate: 'tool_call_update',
      toolCallId: block.id,
      status: 'failed',
      content: [],
    });
  }
}

/**
 * ai tool_call -> in_progress tool_call. Field names + shape mirror the live
 * start path in zed-tool-handler.ts (emitToolCallStart): status 'in_progress',
 * empty content, locations inferred from the recorded parameters via the SAME
 * buildToolLocations helper, kind inferred via the SAME inferToolKind table, and
 * rawInput carrying the narrowed parameters. kind is omitted (rather than sent
 * as undefined) for unknown tools; both are wire-identical after JSON encoding.
 */
function buildToolCallStart(block: ToolCallBlock): acp.SessionUpdate {
  const kind = inferToolKind(block.name);
  const rawInput = toRawInput(block.parameters);
  return {
    sessionUpdate: 'tool_call',
    toolCallId: block.id,
    title: block.name,
    status: 'in_progress',
    content: [],
    locations: buildToolLocations(rawInput ?? {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(rawInput !== undefined ? { rawInput } : {}),
  };
}

/**
 * tool tool_response -> terminal tool_call_update. Status is 'failed' when the
 * block carries an error (ToolResponseBlock.error) OR its result is an object
 * with a string `error` property (the { error } failure shape produced by
 * createErrorResponse), else 'completed'. The displayed text is extracted with a
 * precedence that mirrors how results are actually recorded: result.output
 * (the { output } success shape), then a string result.content, then the failure
 * error text, then the shared extractToolResultText fallback. Only non-empty
 * text yields a content entry; otherwise the update carries an empty content
 * array (mirroring the live suppressed-display behavior).
 *
 * Diff replay gap: the recorded IContent does NOT persist the display/FileDiff
 * metadata the live path uses to emit a { type: 'diff' } ToolCallContent, so a
 * faithful diff replay is not reconstructable from recorded history yet. It is
 * intentionally deferred here (tracked on issue #1604); replay surfaces the
 * textual result instead of a structured diff.
 */
function mapToolResponseBlock(block: ToolResponseBlock): acp.SessionUpdate {
  const record = asRecord(block.result);
  const failed = isFailedResponse(block, record);
  const text = extractResponseText(block, record, failed);
  const content: acp.ToolCallContent[] =
    text !== null && text.length > 0
      ? [{ type: 'content', content: { type: 'text', text } }]
      : [];
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId: block.callId,
    status: failed ? 'failed' : 'completed',
    content,
  };
}

/**
 * A recorded tool response is a failure when its block carries a non-empty
 * error string OR its result object exposes a non-empty string `error` property
 * (the { error } shape emitted by the core createErrorResponse path).
 */
function isFailedResponse(
  block: ToolResponseBlock,
  record: Dict | null,
): boolean {
  if (typeof block.error === 'string' && block.error.length > 0) {
    return true;
  }
  return typeof record?.error === 'string' && record.error.length > 0;
}

/**
 * Extracts the display text for a tool response with the precedence documented
 * on mapToolResponseBlock: result.output, then string result.content, then (for
 * failures) the error text, then the shared extractToolResultText fallback.
 * Returns null when no non-empty text is representable.
 */
function extractResponseText(
  block: ToolResponseBlock,
  record: Dict | null,
  failed: boolean,
): string | null {
  const output = record?.output;
  if (typeof output === 'string' && output.length > 0) {
    return output;
  }
  const inlineContent = record?.content;
  if (typeof inlineContent === 'string' && inlineContent.length > 0) {
    return inlineContent;
  }
  if (failed) {
    const errorText = failureText(block, record);
    if (errorText !== null) {
      return errorText;
    }
  }
  return extractToolResultText({ llmContent: block.result });
}

/**
 * Returns the failure text for a failed response: the block-level error string
 * when present, else a string result.error property, else null.
 */
function failureText(
  block: ToolResponseBlock,
  record: Dict | null,
): string | null {
  if (typeof block.error === 'string' && block.error.length > 0) {
    return block.error;
  }
  const resultError = record?.error;
  if (typeof resultError === 'string' && resultError.length > 0) {
    return resultError;
  }
  return null;
}

/**
 * Narrows a stored ToolCallBlock.parameters (typed `unknown`) to the `rawInput`
 * shape ACP expects: a JSON object, or undefined when the stored value is not a
 * plain object (so the wire payload never carries a non-object rawInput).
 */
function toRawInput(parameters: unknown): Dict | undefined {
  const record = asRecord(parameters);
  return record ?? undefined;
}

/**
 * Narrows an unknown value to a readonly JSON object (non-null, non-array
 * object), or null otherwise. Local to this module so the mapping stays
 * self-contained and pure.
 */
function asRecord(value: unknown): Dict | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Dict;
  }
  return null;
}
