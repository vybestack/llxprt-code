/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type {
  IContent,
  ContentBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Issue #3130 slice 4 — request-shape provenance (AC-5 + AC-6).
 *
 * PURE module: no I/O, no logger dependency.  Given the neutral request that
 * is about to be sent to a provider, it derives the token buckets, the
 * tool-call attribution array, the new-vs-carried tool-result split, and the
 * prefix fingerprint.
 *
 * Per-send cost is O(n) in the number of request contents: each content is
 * serialized and token-counted exactly once.  The token-counting function is
 * injected so callers control the estimator; the wiring uses the same
 * tiktoken-based {@link estimateTokens} the codebase already uses for prompt
 * estimation.
 */

/**
 * The genuine truncation marker appended by the codebase's tool-output
 * limiters (`packages/core/src/utils/toolOutputLimiter.ts` and
 * `packages/tools/src/utils/toolOutputLimiter.ts`).  Both append this exact
 * string when a tool result exceeds its token budget.  Its presence in a
 * serialized tool-response body is the only real truncation signal that
 * survives into `requestContents` — the limiter's boolean `wasTruncated` flag
 * is not carried on the {@link ToolResponseBlock}.  We detect the marker
 * substring (without storing the body) rather than inventing a heuristic.
 */
export const TOOL_OUTPUT_TRUNCATION_MARKER =
  '[Output truncated due to token limit]';

/**
 * Stable, explicit marker recorded when a tool-response's callId cannot be
 * matched to a tool-call block AND the response block carries no `toolName`.
 * Chosen over an empty string so downstream analysis can distinguish
 * "unresolved" from "known but empty".
 */
export const UNRESOLVED_TOOL_NAME = '__unresolved_tool__';

/**
 * Number of hex characters retained from the sha256 digest for the prefix
 * fingerprint.  16 hex chars = 64 bits, giving a collision probability below
 * 1e-19 for realistic session sizes — ample to detect a prefix change while
 * keeping the stored value compact.
 */
export const FINGERPRINT_HEX_LENGTH = 16;

/** Maximum distinct callIds retained in per-session memory before FIFO eviction. */
export const DEFAULT_MAX_SENT_CALL_IDS = 2000;

/** Injected token-counting function (synchronous). */
export type TokenCountFn = (text: string) => number;

/**
 * Inputs to the pure shape computation.  `previouslySentCallIds` and
 * `previousFingerprint` are session snapshots — the pure function never
 * mutates them.
 */
export interface RequestShapeInput {
  readonly requestContents: readonly IContent[];
  readonly tools: unknown;
  readonly instructionsText: string | undefined;
  readonly countTokens: TokenCountFn;
  readonly previouslySentCallIds: ReadonlySet<string>;
  readonly previousFingerprint?: string | undefined;
}

/** A single tool-call attribution entry (AC-5). */
export interface ToolCallAttribution {
  readonly callId: string;
  readonly toolName: string;
  readonly resultTokens: number;
  readonly wasTruncated: boolean;
}

/** The computed request-shape values (AC-5 + AC-6). */
export interface RequestShapeResult {
  readonly instructionsTokens: number;
  readonly toolsSchemaTokens: number;
  readonly historyTokens: number;
  readonly mediaTokens: number;
  readonly injectedTokens: number;
  readonly toolCalls: readonly ToolCallAttribution[];
  readonly newToolResultTokens: number;
  readonly carriedToolResultTokens: number;
  readonly prefixFingerprint: string;
  readonly prefixFingerprintChanged: boolean | null;
}

// ---------------------------------------------------------------------------
// Serialization for token counting
// ---------------------------------------------------------------------------

/**
 * Serialize a single content block to a representative string whose token
 * count approximates what the provider will bill.  The string is used ONLY
 * for counting — it is never persisted, so tool arguments and result bodies
 * do not leak (AC-10).  Media data is replaced by a length proxy so large
 * base64 payloads are not fed through the tokenizer (cost discipline).
 */
function serializeBlockForCounting(block: ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'thinking':
      return block.thought;
    case 'tool_call':
      return block.name + stableStringify(block.parameters);
    case 'tool_response':
      return stableStringify(block.result);
    case 'media':
      // Length proxy avoids re-tokenizing large base64 payloads.
      return `${block.mimeType}:${block.encoding}:${block.data.length}`;
    case 'code':
      return block.code;
    default: {
      // Exhaustive guard: every ContentBlock variant is handled above.
      const exhaustive: never = block;
      void exhaustive;
      return '';
    }
  }
}

function serializeContentForCounting(content: IContent): string {
  return content.blocks.map(serializeBlockForCounting).join('\n');
}

/** True when a content carries at least one MediaBlock. */
function hasMediaBlock(content: IContent): boolean {
  return content.blocks.some((b) => b.type === 'media');
}

/**
 * Determine the bucket assignment for a single content.  The precedence
 * ensures every content lands in EXACTLY one bucket:
 *   1. injected  — metadata.synthetic === true
 *   2. media     — contains a media block (and is not synthetic)
 *   3. history   — everything else
 */
type ContentBucket = 'injected' | 'media' | 'history';

function classifyContent(content: IContent): ContentBucket {
  if (content.metadata?.synthetic === true) return 'injected';
  if (hasMediaBlock(content)) return 'media';
  return 'history';
}

// ---------------------------------------------------------------------------
// Truncation detection
// ---------------------------------------------------------------------------

/**
 * Detect the genuine truncation marker inside a tool-response result body.
 * The body is stringified (it may be an object/array) and checked for the
 * marker substring.  No body content is retained — only the boolean.
 */
function detectTruncation(result: unknown): boolean {
  if (typeof result === 'string') {
    return result.includes(TOOL_OUTPUT_TRUNCATION_MARKER);
  }
  if (result === null || result === undefined) return false;
  return stableStringify(result).includes(TOOL_OUTPUT_TRUNCATION_MARKER);
}

// ---------------------------------------------------------------------------
// Prefix fingerprint
// ---------------------------------------------------------------------------

/**
 * Build a stable serialization of the request prefix for fingerprinting.
 * The serialization includes instructions + tool schemas + all request
 * contents, joined by delimiters that cannot appear inside a JSON string
 * escape.  The resulting string is hashed (never stored), so no prompt text
 * leaks — only the sha256 digest is retained (AC-10).
 */
function serializePrefixForFingerprint(
  instructionsText: string | undefined,
  tools: unknown,
  requestContents: readonly IContent[],
): string {
  const parts: string[] = [];
  parts.push(`I:${instructionsText ?? ''}`);
  parts.push(`T:${stableStringify(tools)}`);
  for (const content of requestContents) {
    parts.push(
      `C:${content.speaker}:${content.metadata?.synthetic === true ? 1 : 0}:${serializeContentForCounting(content)}`,
    );
  }
  return parts.join('\u0000');
}

/**
 * Deterministic stringify that sorts object keys, so two structurally
 * identical tool schemas produce the same string regardless of key insertion
 * order, and that never throws.
 *
 * Tool schemas, tool arguments and tool result bodies are third-party data:
 * they can be cyclic, and they can contain values `JSON.stringify` rejects.
 * This runs on the request path before every send, so a throw here would abort
 * a real conversation to satisfy telemetry. Cycles are collapsed to a marker
 * rather than followed. The output is only ever token-counted or hashed, never
 * persisted (AC-10).
 */
/** Total order over object keys, so serialization is insertion-order free. */
function compareKeys(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

function stableStringify(value: unknown, seen?: WeakSet<object>): string {
  if (value === undefined || typeof value === 'function') return '';
  if (typeof value === 'bigint') return `"${value.toString()}"`;
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  // Ancestors only. A shared sub-schema referenced by several tool
  // declarations is repetition, not a cycle: leaving it in the set would
  // collapse it to the marker and understate tools_schema_tokens.
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value)) return '"[circular]"';
  visited.add(value);
  const serialized = Array.isArray(value)
    ? `[${value.map((entry) => stableStringify(entry, visited)).join(',')}]`
    : `{${Object.entries(value)
        .sort(([a], [b]) => compareKeys(a, b))
        .map(
          ([key, val]) =>
            `${JSON.stringify(key)}:${stableStringify(val, visited)}`,
        )
        .join(',')}}`;
  visited.delete(value);
  return serialized;
}

function computeFingerprint(prefix: string): string {
  return createHash('sha256')
    .update(prefix)
    .digest('hex')
    .slice(0, FINGERPRINT_HEX_LENGTH);
}

// ---------------------------------------------------------------------------
// Core computation helpers
// ---------------------------------------------------------------------------

/** Count tokens for the system instruction text (0 when absent/empty). */
function countInstructionsTokens(
  instructionsText: string | undefined,
  countTokens: TokenCountFn,
): number {
  if (instructionsText === undefined || instructionsText.length === 0) return 0;
  return countTokens(instructionsText);
}

/** Count tokens for the serialized tool schemas (0 when absent/empty). */
function countToolsSchemaTokens(
  tools: unknown,
  countTokens: TokenCountFn,
): number {
  const toolsJson = stableStringify(tools);
  if (toolsJson === 'null' || toolsJson.length <= 2) return 0;
  return countTokens(toolsJson);
}

/** Build a tool-call id → name map from the request contents. */
function buildToolCallNameMap(
  requestContents: readonly IContent[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const content of requestContents) {
    for (const block of content.blocks) {
      if (block.type === 'tool_call') {
        map.set(block.id, block.name);
      }
    }
  }
  return map;
}

/**
 * Pure computation of the request shape.  Reads the session snapshots
 * (`previouslySentCallIds`, `previousFingerprint`) but never mutates them.
 * The caller is responsible for updating session memory after this returns.
 */
export function computeRequestShape(
  input: RequestShapeInput,
): RequestShapeResult {
  const { countTokens, requestContents } = input;
  const toolCallNames = buildToolCallNameMap(requestContents);

  let historyTokens = 0;
  let mediaTokens = 0;
  let injectedTokens = 0;
  const toolCalls: ToolCallAttribution[] = [];
  let newToolResultTokens = 0;
  let carriedToolResultTokens = 0;

  for (const content of requestContents) {
    const bucket = classifyContent(content);
    const contentTokens = countTokens(serializeContentForCounting(content));

    if (bucket === 'injected') {
      injectedTokens += contentTokens;
    } else if (bucket === 'media') {
      mediaTokens += contentTokens;
    } else {
      historyTokens += contentTokens;
    }

    for (const block of content.blocks) {
      if (block.type !== 'tool_response') continue;
      const resultTokens = countTokens(stableStringify(block.result));
      toolCalls.push({
        callId: block.callId,
        toolName: resolveToolName(block, toolCallNames),
        resultTokens,
        wasTruncated: detectTruncation(block.result),
      });
      if (input.previouslySentCallIds.has(block.callId)) {
        carriedToolResultTokens += resultTokens;
      } else {
        newToolResultTokens += resultTokens;
      }
    }
  }

  const prefix = serializePrefixForFingerprint(
    input.instructionsText,
    input.tools,
    requestContents,
  );
  const prefixFingerprint = computeFingerprint(prefix);
  const prefixFingerprintChanged =
    input.previousFingerprint === undefined
      ? null
      : input.previousFingerprint !== prefixFingerprint;

  return {
    instructionsTokens: countInstructionsTokens(
      input.instructionsText,
      countTokens,
    ),
    toolsSchemaTokens: countToolsSchemaTokens(input.tools, countTokens),
    historyTokens,
    mediaTokens,
    injectedTokens,
    toolCalls,
    newToolResultTokens,
    carriedToolResultTokens,
    prefixFingerprint,
    prefixFingerprintChanged,
  };
}

/**
 * Resolve a tool-response's name.  Primary source is the matching tool_call
 * block (same id); secondary is the response block's own `toolName` field;
 * final fallback is the stable {@link UNRESOLVED_TOOL_NAME} marker.
 */
function resolveToolName(
  resp: ToolResponseBlock,
  toolCallNames: ReadonlyMap<string, string>,
): string {
  const fromCall = toolCallNames.get(resp.callId);
  if (fromCall !== undefined && fromCall.length > 0) return fromCall;
  if (resp.toolName.length > 0) return resp.toolName;
  return UNRESOLVED_TOOL_NAME;
}

// ---------------------------------------------------------------------------
// Per-session memory (bounded)
// ---------------------------------------------------------------------------

/**
 * Per-session memory for request-shape tracking.  Owns:
 * - a bounded set of previously-sent tool callIds (for the new/carried split);
 * - the previous request's prefix fingerprint (for change detection).
 *
 * Bounded by {@link maxCallIds}: when the set reaches capacity the oldest
 * inserted callId is evicted (FIFO), so memory stays constant across a long
 * session.  After eviction a callId that was pushed out may be re-classified
 * as "new" on a later send — an acceptable, documented trade-off for bounded
 * memory, and rare in practice (requires the same tool result to be re-sent
 * after `maxCallIds` other distinct results displaced it).
 */
export class RequestShapeSessionMemory {
  private readonly sentCallIds = new Set<string>();
  private lastFp: string | undefined;
  private readonly maxCallIds: number;

  constructor(maxCallIds: number = DEFAULT_MAX_SENT_CALL_IDS) {
    this.maxCallIds = maxCallIds;
  }

  /** Number of distinct callIds currently retained. */
  get sentCallIdCount(): number {
    return this.sentCallIds.size;
  }

  /**
   * Compute the request shape using this memory's session snapshots, then
   * update the memory: mark every tool-result callId in this request as sent
   * and record the new fingerprint.
   */
  recordRequestShape(
    input: Omit<
      RequestShapeInput,
      'previouslySentCallIds' | 'previousFingerprint'
    >,
  ): RequestShapeResult {
    const result = computeRequestShape({
      ...input,
      previouslySentCallIds: this.sentCallIds,
      previousFingerprint: this.lastFp,
    });

    for (const tc of result.toolCalls) {
      this.markCallIdSent(tc.callId);
    }
    this.lastFp = result.prefixFingerprint;

    return result;
  }

  /** Add a callId, evicting the oldest entry when at capacity (FIFO). */
  private markCallIdSent(callId: string): void {
    if (this.sentCallIds.has(callId)) return;
    if (this.sentCallIds.size >= this.maxCallIds) {
      const oldest = this.sentCallIds.values().next().value;
      if (oldest !== undefined) {
        this.sentCallIds.delete(oldest);
      }
    }
    this.sentCallIds.add(callId);
  }
}
