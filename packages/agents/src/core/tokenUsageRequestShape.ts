/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import type {
  IContent,
  ContentBlock,
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

/**
 * How many characters of serialized history feed the prefix fingerprint.
 *
 * The fingerprint answers "did the cacheable head of this request change", so
 * it only needs the head. Bounding it also keeps the per-send cost constant
 * instead of growing with the conversation.
 */
export const FINGERPRINT_PREFIX_CHAR_BUDGET = 8192;

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
  /**
   * Optional per-session measurement cache. Without it every content is
   * re-tokenized on every send, which is linear per send and quadratic over a
   * session; with it a carried content is tokenized once.
   */
  readonly measurementCache?: ContentMeasurementCache | undefined;
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

/** A tool result measured from its already-serialized body. */
interface MeasuredToolResult {
  readonly callId: string;
  readonly blockToolName: string;
  readonly resultTokens: number;
  readonly wasTruncated: boolean;
}

/**
 * A content's measured token costs. Deliberately holds no serialized text, so
 * caching one across a session does not retain a large tool-result body.
 */
export interface ContentMeasurement {
  readonly tokens: number;
  readonly toolResults: readonly MeasuredToolResult[];
}

/**
 * Cache of per-content measurements for one session, keyed by
 * {@link measurementCacheKey}. Lets a carried content be tokenized once ever
 * rather than once per send.
 */
export interface ContentMeasurementCache {
  get(key: string): ContentMeasurement | undefined;
  set(key: string, measurement: ContentMeasurement): void;
}

/**
 * Cache key for a content's measurement.
 *
 * `metadata.id` is stamped when the turn is created and survives the history
 * pipeline's per-send rebuild, so it identifies the same logical content across
 * sends even though the object itself is new every time. The block count is
 * appended as cheap insurance: if a content were ever extended in place under a
 * reused id, the key changes and the stale measurement is not used.
 *
 * Returns null when the content has no id, in which case it is measured
 * normally but not cached.
 */
function measurementCacheKey(content: IContent): string | null {
  const id = content.metadata?.id;
  if (id !== undefined && id.length > 0)
    return `${id}:${content.blocks.length}`;
  // The history pipeline does not preserve `metadata.id` on tool contents, which
  // are the expensive ones. Their blocks carry their own stable identities, so
  // fall back to those rather than leaving a large body uncacheable.
  const blockKeys = content.blocks.map(blockCacheKey);
  if (blockKeys.some((key) => key === null)) return null;
  return `blocks:${blockKeys.join(',')}`;
}

/**
 * Stable identity for a block, when it has one. A tool result is identified by
 * the call it answers and a tool call by its own id; both are unique and
 * immutable, so a body carried across many turns is measured once.
 */
function blockCacheKey(block: ContentBlock): string | null {
  if (block.type === 'tool_response') return `tr:${block.callId}`;
  if (block.type === 'tool_call') return `tc:${block.id}`;
  return null;
}

/**
 * Measure one content, serializing each block exactly ONCE and reusing that
 * string for the content's token count, each tool result's token count, the
 * truncation check, and the prefix fingerprint. An earlier revision serialized
 * the same tool-result body four times per send.
 */
function measureContent(
  content: IContent,
  countTokens: TokenCountFn,
): { measurement: ContentMeasurement; serialized: string } {
  const serializedBlocks = content.blocks.map(serializeBlockForCounting);
  const toolResults: ContentMeasurement['toolResults'] = content.blocks.flatMap(
    (block, index) =>
      block.type === 'tool_response'
        ? [
            {
              callId: block.callId,
              blockToolName: block.toolName,
              resultTokens: countTokens(serializedBlocks[index]),
              wasTruncated: serializedBlocks[index].includes(
                TOOL_OUTPUT_TRUNCATION_MARKER,
              ),
            },
          ]
        : [],
  );
  const serialized = serializedBlocks.join('\n');
  return {
    measurement: { tokens: countTokens(serialized), toolResults },
    serialized,
  };
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

// ---------------------------------------------------------------------------
// Prefix fingerprint
// ---------------------------------------------------------------------------

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
  // Symbols belong here, not below: `JSON.stringify(Symbol())` returns
  // undefined, which would break this function's string contract and surface as
  // a TypeError further along the request path.
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol'
  ) {
    return '';
  }
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
  toolsJson: string,
  countTokens: TokenCountFn,
): number {
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
/** A content's contribution to the prefix fingerprint, and its budget cost. */
interface FingerprintContribution {
  readonly text: string;
  readonly consumed: number;
}

/**
 * Measure one content, using and populating the session cache, and produce its
 * fingerprint contribution.
 *
 * Serialization happens only when something still needs the string: the content
 * has never been measured, or it has no stable identity and the fingerprint
 * still has budget. Past the budget an already-measured content costs nothing,
 * which is what keeps a long conversation from being re-serialized and
 * re-tokenized on every send.
 */
function resolveContentMeasurement(
  content: IContent,
  countTokens: TokenCountFn,
  fingerprintBudget: number,
  cache: ContentMeasurementCache | undefined,
): {
  measurement: ContentMeasurement;
  fingerprintPart: FingerprintContribution | null;
} {
  const cacheKey = measurementCacheKey(content);
  const cached = cacheKey === null ? undefined : cache?.get(cacheKey);
  const needsSerialization =
    cached === undefined || (cacheKey === null && fingerprintBudget > 0);
  const fresh = needsSerialization
    ? measureContent(content, countTokens)
    : undefined;
  const measurement = cached ?? fresh?.measurement;
  // `needsSerialization` is true whenever `cached` is undefined, so one of the
  // two is always present; this keeps that invariant explicit for the reader.
  if (measurement === undefined) {
    throw new Error('Content measurement resolved to neither cache nor fresh');
  }
  if (cached === undefined && cacheKey !== null) {
    cache?.set(cacheKey, measurement);
  }

  return {
    measurement,
    fingerprintPart: buildFingerprintContribution(
      content,
      cacheKey,
      fresh?.serialized,
      fingerprintBudget,
    ),
  };
}

/**
 * A content's fingerprint contribution, or null when the budget is spent.
 *
 * An identified content contributes its id: the id is stable across sends and
 * changes when the content is replaced, so hashing it detects the prefix changes
 * that break a provider cache (instructions edited, tool schemas changed, a head
 * rewritten by compression, reordered or dropped turns) without re-reading any
 * body.
 */
function buildFingerprintContribution(
  content: IContent,
  cacheKey: string | null,
  serialized: string | undefined,
  budget: number,
): FingerprintContribution | null {
  if (budget <= 0) return null;
  if (cacheKey !== null) {
    const text = `C#${cacheKey}`;
    return { text, consumed: text.length };
  }
  if (serialized === undefined) return null;
  const synthetic = content.metadata?.synthetic === true ? 1 : 0;
  return {
    text: `C:${content.speaker}:${synthetic}:${serialized.slice(0, budget)}`,
    consumed: serialized.length,
  };
}

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

  const toolsJson = stableStringify(input.tools);
  // Instructions and tool schemas are the head of the cacheable prefix and are
  // always included in full; history then fills the remaining budget.
  const fingerprintParts: string[] = [
    `I:${input.instructionsText ?? ''}`,
    `T:${toolsJson}`,
  ];
  let fingerprintBudget = FINGERPRINT_PREFIX_CHAR_BUDGET;

  for (const content of requestContents) {
    const { measurement, fingerprintPart } = resolveContentMeasurement(
      content,
      countTokens,
      fingerprintBudget,
      input.measurementCache,
    );

    const bucket = classifyContent(content);
    if (bucket === 'injected') {
      injectedTokens += measurement.tokens;
    } else if (bucket === 'media') {
      mediaTokens += measurement.tokens;
    } else {
      historyTokens += measurement.tokens;
    }

    for (const result of measurement.toolResults) {
      toolCalls.push({
        callId: result.callId,
        toolName: resolveToolName(
          result.callId,
          result.blockToolName,
          toolCallNames,
        ),
        resultTokens: result.resultTokens,
        wasTruncated: result.wasTruncated,
      });
      if (input.previouslySentCallIds.has(result.callId)) {
        carriedToolResultTokens += result.resultTokens;
      } else {
        newToolResultTokens += result.resultTokens;
      }
    }

    if (fingerprintPart !== null) {
      fingerprintParts.push(fingerprintPart.text);
      fingerprintBudget -= fingerprintPart.consumed;
    }
  }

  const prefixFingerprint = computeFingerprint(fingerprintParts.join('\u0000'));
  const prefixFingerprintChanged =
    input.previousFingerprint === undefined
      ? null
      : input.previousFingerprint !== prefixFingerprint;

  return {
    instructionsTokens: countInstructionsTokens(
      input.instructionsText,
      countTokens,
    ),
    toolsSchemaTokens: countToolsSchemaTokens(toolsJson, countTokens),
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
  callId: string,
  blockToolName: string,
  toolCallNames: ReadonlyMap<string, string>,
): string {
  const fromCall = toolCallNames.get(callId);
  if (fromCall !== undefined && fromCall.length > 0) return fromCall;
  if (blockToolName.length > 0) return blockToolName;
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
export class RequestShapeSessionMemory implements ContentMeasurementCache {
  private readonly sentCallIds = new Set<string>();
  private lastFp: string | undefined;
  private readonly maxCallIds: number;

  /**
   * Per-content measurements, so a content carried across many turns is
   * tokenized once instead of on every send. Holds counts only — never
   * serialized bodies — and is FIFO-bounded like {@link sentCallIds}. An evicted
   * content is simply re-measured on its next send; nothing is wrong, only
   * slower.
   */
  private readonly measurements = new Map<string, ContentMeasurement>();

  constructor(maxCallIds: number = DEFAULT_MAX_SENT_CALL_IDS) {
    this.maxCallIds = maxCallIds;
  }

  /** Number of cached content measurements currently retained. */
  get measurementCount(): number {
    return this.measurements.size;
  }

  get(key: string): ContentMeasurement | undefined {
    return this.measurements.get(key);
  }

  set(key: string, measurement: ContentMeasurement): void {
    if (this.measurements.size >= this.maxCallIds) {
      const oldest = this.measurements.keys().next().value;
      if (oldest !== undefined) this.measurements.delete(oldest);
    }
    this.measurements.set(key, measurement);
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
      measurementCache: this,
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
