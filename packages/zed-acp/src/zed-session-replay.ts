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
 * Tool-call fidelity (order-aware pairing): the live path emits a tool_call
 * (status 'in_progress', empty content, inferred locations/kind) at call time
 * and a SEPARATE tool_call_update (completed/failed with the result text) when
 * the response arrives. Replay mirrors that two-update shape via a SINGLE
 * ordered walk that tracks a `pending` set of started-but-unfinished callIds:
 *
 *  - an ai ToolCallBlock emits the in_progress tool_call and marks the id
 *    pending;
 *  - a tool ToolResponseBlock whose id IS pending emits exactly ONE terminal
 *    tool_call_update (first response wins) and clears the id — a duplicate
 *    response for the same id is then dropped;
 *  - a tool ToolResponseBlock whose id is NOT pending (an orphan response before
 *    its start, or a second response after completion) is DROPPED so replay
 *    never emits a floating terminal update with no matching start;
 *  - any id still pending at end-of-history (an interrupted turn) gets a
 *    synthetic 'failed' tool_call_update, in original start order, so the client
 *    never renders a perpetually-running tool.
 *
 * This ordered pairing (vs a global pre-scan of every response id) keeps the
 * start->end status transitions correct across response-before-call, duplicate
 * responses, and the same id reused across turns.
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
import {
  buildToolLocations,
  inferToolKind,
  toAcpToolKind,
} from './zed-tool-handler.js';
import { extractToolResultText } from './zed-content-utils.js';

/** Readonly JSON-object shape used when narrowing recorded `unknown` payloads. */
type Dict = Readonly<Record<string, unknown>>;

/**
 * Maps a full resumed history (ordered IContent[]) to the ordered ACP
 * SessionUpdate notifications that replay the conversation. Empty/whitespace
 * text chunks are skipped; unmappable blocks (media, code) contribute no update.
 *
 * Tool calls are paired in a single ordered pass (see the module doc): each ai
 * tool_call emits an in_progress tool_call and is tracked as pending; the FIRST
 * tool response for a pending id emits the terminal completed/failed update and
 * clears it; unmatched responses are dropped; and any call still pending after
 * the whole history is walked yields a trailing synthetic failed update, in
 * original start order (Map iteration preserves insertion order). The output
 * preserves history order and, per message, block order.
 */
export function mapHistoryToSessionUpdates(
  items: readonly IContent[],
): acp.SessionUpdate[] {
  const updates: acp.SessionUpdate[] = [];
  const pending = new Map<string, acp.ToolKind>();
  // FINDING D1: iterate as `unknown` because persisted history read back from
  // disk is UNTRUSTED — the static `readonly IContent[]` type is a contract, not
  // a runtime guarantee. A corrupt/truncated JSONL line can yield a null item or
  // one whose `blocks` is missing/non-array; asRenderableContent narrows each
  // against the real runtime shape so a malformed entry is skipped instead of
  // throwing and aborting the WHOLE load.
  for (const raw of items as readonly unknown[]) {
    const item = asRenderableContent(raw);
    if (item === null) {
      continue;
    }
    // FINDING D1 (block level): each ELEMENT of a narrowed blocks array is STILL
    // untrusted — the item-level narrowing only proved `blocks` is an array, not
    // that its elements are objects. Persisted JSONL can carry blocks: [null],
    // [undefined], [42], ['x'], [{}] (no type), or [{type: 42}]. asRenderableBlock
    // narrows every element to a non-null object with a STRING `type`, so a
    // malformed element is skipped silently (matching the malformed-ITEM skip)
    // instead of throwing on `block.type` in appendBlockUpdates and aborting the
    // WHOLE replay. A valid block AFTER a malformed one in the same item — and a
    // valid item AFTER a malformed-blocks item — both still replay.
    for (const rawBlock of item.blocks) {
      const block = asRenderableBlock(rawBlock);
      if (block === null) {
        continue;
      }
      appendBlockUpdates(item.speaker, block, pending, updates);
    }
  }
  // Every id still pending had no delivered response (an interrupted turn):
  // synthesize its terminal failed update now, in start order, so the client
  // does not render a perpetually-running tool. Map iteration preserves the
  // insertion (call-start) order.
  for (const [toolCallId, kind] of pending) {
    updates.push(buildSyntheticFailedUpdate(toolCallId, kind));
  }
  return updates;
}

/**
 * Appends the SessionUpdate(s) for a single (speaker, block) pair to `out`,
 * mutating `pending` for tool-call lifecycle tracking. Text/thinking map to at
 * most one update; an ai tool_call emits its in_progress start and marks the id
 * pending; a tool-speaker tool_response emits its terminal update only when it pairs
 * with a pending start (see appendToolResponseUpdate).
 */
function appendBlockUpdates(
  speaker: IContent['speaker'],
  block: ContentBlock,
  pending: Map<string, acp.ToolKind>,
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
      // FINDING D4: a tool_call whose id is missing/non-string cannot be tracked
      // (nothing could ever pair its response) and would emit an update carrying
      // an undefined toolCallId on the wire. Skip it entirely.
      if (speaker === 'ai' && isNonEmptyString(block.id)) {
        const kind = toolKindForRecordedCall(block);
        const previousKind = pending.get(block.id);
        if (previousKind !== undefined) {
          out.push(buildSyntheticFailedUpdate(block.id, previousKind));
        }
        out.push(buildToolCallStart(block, kind));
        pending.set(block.id, kind);
      }
      return;
    case 'tool_response':
      // FINDING D4: a tool_response without a string callId can never pair with a
      // started call, so it would always be dropped by the pending check anyway;
      // guard explicitly so the intent is clear and no undefined id is handled.
      if (speaker === 'tool' && isNonEmptyString(block.callId)) {
        appendToolResponseUpdate(block, pending, out);
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

/**
 * Emits the terminal tool_call_update for a recorded tool response, order-aware
 * against the `pending` set of started-but-unfinished calls:
 *  - if the callId IS pending: emit exactly ONE terminal update (first response
 *    wins) and clear the id so a later duplicate response for the same id is
 *    dropped;
 *  - if the callId is NOT pending (an orphan response that arrived before its
 *    start, or a second response after the call already completed): DROP it.
 *    Emitting a floating terminal update with no matching in_progress start
 *    would hand the client a tool_call_update it never saw begin, corrupting the
 *    status transition; dropping keeps replay wire-consistent with the live
 *    start->end pairing.
 */
function appendToolResponseUpdate(
  block: ToolResponseBlock,
  pending: Map<string, acp.ToolKind>,
  out: acp.SessionUpdate[],
): void {
  const kind = pending.get(block.callId);
  if (kind === undefined) {
    return;
  }
  pending.delete(block.callId);
  out.push(mapToolResponseBlock(block, kind));
}

/**
 * Builds the synthetic terminal update for a tool call that never received a
 * response: a 'failed' tool_call_update with empty content, matching the live
 * behavior of never leaving a perpetually-running tool on the client.
 */
function buildSyntheticFailedUpdate(
  toolCallId: string,
  kind: acp.ToolKind,
): acp.SessionUpdate {
  return {
    sessionUpdate: 'tool_call_update',
    toolCallId,
    status: 'failed',
    content: [],
    kind,
  };
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
  // FINDING D2: guard against a non-string `text` in malformed persisted data
  // (mirrors the guard mapThinkingBlock already has for `thought`). Calling
  // .trim() on a non-string would throw and abort the load; skip instead.
  if (typeof text !== 'string' || text.trim().length === 0) {
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
 * ai tool_call -> in_progress tool_call. Field names + shape mirror the live
 * start path in zed-tool-handler.ts (emitToolCallStart): status 'in_progress',
 * empty content, locations inferred from the recorded parameters via the SAME
 * buildToolLocations helper, kind inferred via the SAME inferToolKind table and
 * normalized to `other` for unknown tools, and rawInput ALWAYS present ({} when
 * parameters are missing/malformed) exactly as the live path sends call.args.
 */
function buildToolCallStart(
  block: ToolCallBlock,
  kind: acp.ToolKind,
): acp.SessionUpdate {
  // FINDING D4: fall back to the id for the title when `name` is missing/non-
  // string in malformed persisted data. Keeping the (already-validated string)
  // id as the title preserves identifying info on the wire rather than sending
  // an undefined title.
  const hasName = isNonEmptyString(block.name);
  // rawInput is sent unconditionally ({} when the recorded parameters are
  // missing/malformed) to stay wire-identical with the live start path in
  // zed-tool-handler.ts (emitToolCallStart), which always includes rawInput.
  const rawInput = toRawInput(block.parameters) ?? {};
  return {
    sessionUpdate: 'tool_call',
    toolCallId: block.id,
    title: hasName ? block.name : block.id,
    status: 'in_progress',
    content: [],
    locations: buildToolLocations(rawInput),
    kind,
    rawInput,
  };
}

function toolKindForRecordedCall(block: ToolCallBlock): acp.ToolKind {
  return toAcpToolKind(
    isNonEmptyString(block.name) ? inferToolKind(block.name) : undefined,
  );
}

/**
 * True when `value` is a non-empty string. Used to validate persisted tool-call
 * ids/callIds/names read back from disk (FINDING D4) before they are emitted on
 * the wire, so a corrupt block never yields an update with an undefined id.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** The valid IContent speaker discriminators a persisted item may carry. */
const VALID_SPEAKERS: ReadonlySet<IContent['speaker']> = new Set([
  'human',
  'ai',
  'tool',
]);

/**
 * Narrows an UNTRUSTED persisted history entry to a renderable IContent — a
 * non-null object whose `speaker` is a valid discriminator ('human' | 'ai' |
 * 'tool') and whose `blocks` is an array (FINDING D1). Returns null for a
 * null/undefined item or one whose speaker/blocks is missing/invalid (a
 * corrupt/truncated JSONL line that still JSON-parsed), so the caller skips it
 * rather than throwing on `item.blocks` or silently mapping an unknown speaker.
 * The array ELEMENTS deliberately stay `unknown`: the caller narrows each one
 * with {@link asRenderableBlock} (D1 at the block level) before use, and the
 * type-specific fields are then guarded by the per-block D2/D4 checks. This
 * function only guarantees the speaker union and that `blocks` is iterable — it
 * does NOT (and must not) pretend the raw elements are valid ContentBlocks.
 */
function asRenderableContent(
  value: unknown,
): { speaker: IContent['speaker']; blocks: readonly unknown[] } | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record = value as { speaker?: unknown; blocks?: unknown };
  if (!VALID_SPEAKERS.has(record.speaker as IContent['speaker'])) {
    return null;
  }
  if (!Array.isArray(record.blocks)) {
    return null;
  }
  return {
    speaker: record.speaker as IContent['speaker'],
    blocks: record.blocks as readonly unknown[],
  };
}

/**
 * Narrows a single UNTRUSTED persisted block to a renderable {@link ContentBlock}
 * — a non-null object carrying a STRING `type` discriminator (FINDING D1 at the
 * block level). Returns null for a null/undefined/primitive element or an object
 * with no string `type` (the `blocks: [null]`, `[undefined]`, `[42]`, `['x']`,
 * `[{}]`, `[{type: 42}]` shapes a corrupt/truncated JSONL line can carry), so the
 * caller SKIPS it silently rather than throwing on `block.type` in
 * {@link appendBlockUpdates} and aborting the WHOLE replay.
 *
 * Only the `type` discriminator is validated here; the type-specific fields
 * (text/thought/id/callId) remain guarded downstream by the per-block D2/D4
 * checks exactly as they are for a statically-typed block, so an object with a
 * valid `type` but a malformed payload is still handled defensively rather than
 * throwing. The `as ContentBlock` mirrors the established narrowing idiom in this
 * module (see {@link asRecord} / {@link asRenderableContent}): a runtime check
 * precedes a precise assertion, never `any`.
 */
function asRenderableBlock(value: unknown): ContentBlock | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record = value as { type?: unknown };
  if (typeof record.type !== 'string') {
    return null;
  }
  return value as ContentBlock;
}

/**
 * tool-speaker tool_response -> terminal tool_call_update. Status is 'failed' when the
 * block carries an error (ToolResponseBlock.error) OR its result is an object
 * with a non-empty string `error` property OR a nested `error.message` string
 * (the { error } and { error: { message } } failure shapes produced by
 * createErrorResponse, FINDING F3), else 'completed'. Classification honours
 * either field (see {@link failureText}). The DISPLAYED text, however, prefers
 * the model-facing remedy carried in `result` over the terse top-level marker:
 * it is extracted with a precedence that mirrors how results are actually
 * recorded: result.output (the { output } success shape), then a string
 * result.content, then an MCP-style result.content array (joined text
 * elements), then the display-preferred failure text (result's `error`/
 * `error.message`, falling back to the top-level marker only when `result`
 * carries no usable text), then the shared extractToolResultText fallback.
 * Only non-empty text yields a content entry; otherwise the update carries an
 * empty content array (mirroring the live suppressed-display behavior).
 *
 * Separating classification from display (issue #3063): once createErrorResponse
 * sets the top-level marker, a failed block carries the terse marker in `error`
 * AND the model-facing remedy in `result.error`. Without this split the replay
 * would display the terse marker where it previously displayed the remedy.
 *
 * Diff replay gap: the recorded IContent does NOT persist the display/FileDiff
 * metadata the live path uses to emit a { type: 'diff' } ToolCallContent, so a
 * faithful diff replay is not reconstructable from recorded history yet. It is
 * intentionally deferred here (tracked on issue #1604); replay surfaces the
 * textual result instead of a structured diff.
 */
function mapToolResponseBlock(
  block: ToolResponseBlock,
  kind: acp.ToolKind,
): acp.SessionUpdate {
  const record = asRecord(block.result);
  const failed = failureText(block, record) !== null;
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
    kind,
  };
}

/**
 * Extracts the failure text carried by a result object's `error` property,
 * supporting BOTH the `{ error: string }` shape and the `{ error: { message:
 * string } }` object shape (FINDING F3). Returns the non-empty error/message
 * string, or null when there is no representable error text.
 */
function resultErrorText(record: Dict | null): string | null {
  const resultError = record?.error;
  if (typeof resultError === 'string' && resultError.length > 0) {
    return resultError;
  }
  const nested = asRecord(resultError);
  if (nested !== null) {
    const message = nested.message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return null;
}

/**
 * Extracts the display text for a tool response with the precedence documented
 * on mapToolResponseBlock: result.output, then string result.content, then an
 * MCP-style result.content array, then (for failures) the display-preferred
 * failure text (the model-facing remedy in `result`, falling back to the
 * top-level marker only when `result` carries no usable text), then the shared
 * extractToolResultText fallback. Returns null when no non-empty text is
 * representable.
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
  const arrayText = extractContentArrayText(inlineContent);
  if (arrayText !== null) {
    return arrayText;
  }
  if (failed) {
    const errorText = displayFailureText(block, record);
    if (errorText !== null) {
      return errorText;
    }
  }
  try {
    return extractToolResultText({ llmContent: block.result });
  } catch {
    return null;
  }
}

/**
 * Joins the text of an MCP-style result.content array: keeps only elements that
 * look like `{ type: 'text', text: string }`, concatenates their `text` (no
 * separator, matching how streamed text chunks recombine), and returns the
 * result only when non-empty. Non-text elements (images, resources) are skipped.
 * Returns null when the value is not an array or yields no text, so the caller
 * falls through to the next precedence tier.
 */
function extractContentArrayText(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const text = value
    .map((element) => textOfContentElement(element))
    .filter((entry): entry is string => entry !== null)
    .join('');
  return text.length > 0 ? text : null;
}

/**
 * Narrows a single MCP-style content-array element to its text: returns the
 * `text` string for a `{ type: 'text', text: string }` element whose text is
 * non-whitespace, else null (skipping images/resources, malformed entries, and
 * whitespace-only text elements, FINDING F11). Whitespace-only elements are
 * dropped so a content array of only blank text yields an empty content array on
 * the update rather than passing blank text through.
 */
function textOfContentElement(element: unknown): string | null {
  const record = asRecord(element);
  if (record === null || record.type !== 'text') {
    return null;
  }
  return typeof record.text === 'string' && record.text.trim().length > 0
    ? record.text
    : null;
}

/**
 * Classification helper: returns the failure text used to decide whether a
 * response is `failed`. Honours EITHER failure field — the block-level error
 * string when present, else the result object's error text (string `error` OR
 * nested `error.message`, via {@link resultErrorText}, FINDING F3), else null.
 * Classification precedence does not matter for display; see
 * {@link displayFailureText}.
 */
function failureText(
  block: ToolResponseBlock,
  record: Dict | null,
): string | null {
  if (typeof block.error === 'string' && block.error.length > 0) {
    return block.error;
  }
  return resultErrorText(record);
}

/**
 * Display helper: returns the failure text shown to the user. Unlike
 * {@link failureText} (which is for classification only), this prefers the
 * model-facing remedy carried in `result` (`resultErrorText`) and falls back
 * to the terse top-level `error` marker only when `result` carries no usable
 * text (issue #3063). Returns null when neither field is representable.
 */
function displayFailureText(
  block: ToolResponseBlock,
  record: Dict | null,
): string | null {
  const resultText = resultErrorText(record);
  if (resultText !== null) {
    return resultText;
  }
  if (typeof block.error === 'string' && block.error.length > 0) {
    return block.error;
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
