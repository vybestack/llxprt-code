/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Byte accounting for retained history.
 *
 * `computeStatistics` counts blocks; the chronology trace describes their
 * structure. Neither measures size, so a session could report "812 messages"
 * next to a multi-gigabyte heap with no way to connect the two. This module
 * supplies the missing primitive: how many bytes each history item is holding,
 * and which tool responses are holding them.
 *
 * DESIGN CONSTRAINTS
 *
 * 1. No serialization or copying of payload bodies. `ToolCallBlock.parameters`
 *    and `ToolResponseBlock.result` are `unknown` (arbitrary JSON). The
 *    obvious implementation, `JSON.stringify(value).length`, serializes a
 *    full copy of the value being measured — on a multi-GB history that is
 *    precisely the thing we must not do. Everything here walks structure and
 *    accumulates a number instead.
 *
 * 2. O(1) per string. String cost is derived from `.length`, never by scanning
 *    characters, so sizing a large history stays proportional to the number of
 *    *values* rather than the number of *bytes*.
 *
 * 3. Cycle-safe and depth-capped. Provider metadata is untrusted in shape and
 *    may be self-referential; a naive recursive walk would not terminate.
 *    String fields that restored/external JSON delivered as null (despite the
 *    declared type) are estimated as empty slots rather than crashing the
 *    walk.
 *
 * 4. Shared identity across the COMPLETE retained graph. A
 *    `computeHistorySizeBreakdown` run uses ONE identity set across every
 *    IContent item object, blocks array, ContentBlock object, metadata
 *    object/array, and nested payload: a value referenced from two places is
 *    counted once, at the first reference, and attributed there. This mirrors
 *    what the heap retains. Attribution buckets (`bytesByBlockType`,
 *    `bytesByToolName`, `largestToolResponses`) are therefore SUBSETS of the
 *    total: item-level overhead, speaker strings, and item metadata are
 *    attributed to no bucket, so the buckets need not — and are not expected
 *    to — sum exactly to `totalBytes`.
 *
 * WHAT THESE NUMBERS MEAN AGAINST A LIVE HEAP
 *
 * They are LOGICAL sizes. JSC represents string concatenation as a lazy rope
 * that occupies almost nothing until something reads a character, at which
 * point it flattens to full size. Measured: 4,000 concatenated ~26 KB strings
 * reported 104.0 MB logical while the JSC heap had grown only ~5 MB; after
 * forcing a flatten the heap delta was 104.2 MB — 0.2% from the logical figure.
 *
 * So this module reports what the content WILL cost once materialized (which is
 * also what it costs to send to a provider), and a live heap reading may sit
 * below that until the ropes are touched. Accounting exceeding current heap is
 * therefore an expected state, not an error.
 */

import type { ContentBlock, IContent } from './IContent.js';

/**
 * Assumed bytes per character. JSC stores a string as latin1 (1 byte/char)
 * when every code unit fits in 8 bits and UTF-16 (2 bytes/char) otherwise.
 * Conversation history is overwhelmingly ASCII source text and tool output, so
 * 1 is the right approximation and keeps sizing O(1) per string. Non-ASCII
 * content is therefore under-reported by up to 2x; these numbers are for
 * ranking retainers, not for reconciling against RSS byte-for-byte.
 */
const BYTES_PER_CHAR = 1;

/** Per-value overhead approximating a JSC cell plus property slot. */
const VALUE_OVERHEAD_BYTES = 16;

/**
 * Depth cap for the recursive walk. Real tool results nest a handful of levels;
 * anything deeper is pathological and is charged at the cap rather than
 * explored.
 */
const MAX_DEPTH = 32;

/**
 * Estimated retained bytes of an arbitrary JSON-shaped value.
 *
 * `seen` breaks reference cycles and deduplicates shared references; callers
 * that want a whole-history identity tracker pass the same set across calls.
 * Uses for-in plus hasOwnProperty and Reflect.get rather than Object.entries
 * to avoid allocating an intermediate entries array per object.
 */
function estimateValueBytes(
  value: unknown,
  depth: number,
  seen: Set<object>,
): number {
  if (value === null || value === undefined) {
    return VALUE_OVERHEAD_BYTES;
  }
  if (typeof value === 'string') {
    return VALUE_OVERHEAD_BYTES + value.length * BYTES_PER_CHAR;
  }
  if (typeof value !== 'object') {
    // number, boolean, bigint, symbol, function
    return VALUE_OVERHEAD_BYTES;
  }
  if (depth >= MAX_DEPTH || seen.has(value)) {
    return VALUE_OVERHEAD_BYTES;
  }
  seen.add(value);

  if (ArrayBuffer.isView(value)) {
    return VALUE_OVERHEAD_BYTES + value.byteLength;
  }
  if (value instanceof ArrayBuffer) {
    return VALUE_OVERHEAD_BYTES + value.byteLength;
  }
  if (Array.isArray(value)) {
    let total = VALUE_OVERHEAD_BYTES;
    for (const entry of value) {
      total += estimateValueBytes(entry, depth + 1, seen);
    }
    return total;
  }

  let total = VALUE_OVERHEAD_BYTES;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      total += key.length * BYTES_PER_CHAR;
      total += estimateValueBytes(Reflect.get(value, key), depth + 1, seen);
    }
  }
  return total;
}

/** Estimated retained bytes of a single value, starting a fresh cycle set. */
export function estimateBytes(value: unknown): number {
  return estimateValueBytes(value, 0, new Set<object>());
}

/**
 * Charges an optional string field only when present. Restored/external JSON
 * can deliver null where the type declares `string | undefined`; null is
 * treated as absent rather than crashing.
 */
function optionalStringBytes(s: string | undefined | null): number {
  return typeof s === 'string' ? s.length * BYTES_PER_CHAR : 0;
}

/**
 * Charges a REQUIRED string field by its length. A null-like value that
 * slipped past the types (restored/external JSON) is estimated as one slot
 * instead of crashing the walk.
 */
function requiredStringBytes(s: string | null | undefined): number {
  return typeof s === 'string'
    ? s.length * BYTES_PER_CHAR
    : VALUE_OVERHEAD_BYTES;
}

/**
 * Estimated retained bytes of one content block, including every field the
 * block carries, counted against the shared identity tracker so a value
 * already counted elsewhere in the same traversal is not double-charged.
 * A block object already seen in this traversal contributes nothing.
 */
export function estimateBlockBytesTracked(
  block: ContentBlock,
  seen: Set<object>,
): number {
  if (seen.has(block)) {
    return 0;
  }
  seen.add(block);
  let total = VALUE_OVERHEAD_BYTES;

  switch (block.type) {
    case 'text':
      total += requiredStringBytes(block.text);
      break;
    case 'code':
      total += requiredStringBytes(block.code);
      total += optionalStringBytes(block.language);
      break;
    case 'thinking':
      total += requiredStringBytes(block.thought);
      total += optionalStringBytes(block.encryptedContent);
      total += optionalStringBytes(block.signature);
      total += optionalStringBytes(block.sourceField);
      total += optionalStringBytes(block.streamId);
      total += optionalStringBytes(block.streamStatus);
      break;
    case 'media':
      total += requiredStringBytes(block.mimeType);
      total += requiredStringBytes(block.encoding);
      total += optionalStringBytes(block.caption);
      total += optionalStringBytes(block.filename);
      if (block.providerFiles !== undefined) {
        total += estimateValueBytes(block.providerFiles, 1, seen);
      }
      if (block.encoding !== 'reference') {
        total += requiredStringBytes(block.data);
        break;
      }
      total += block.normalizedBase64Length;
      total += requiredStringBytes(block.contentId);
      total += requiredStringBytes(block.originalContentId);
      total += requiredStringBytes(block.selectedContentId);
      total += VALUE_OVERHEAD_BYTES;
      total += estimateValueBytes(block.originalObject, 1, seen);
      total += estimateValueBytes(block.selectedObject, 1, seen);
      total += estimateValueBytes(block.transformation, 1, seen);
      if (block.dimensions !== undefined) {
        total += estimateValueBytes(block.dimensions, 1, seen);
      }
      total += estimateValueBytes(block.semanticMetadata, 1, seen);
      if (block.providerFileIds !== undefined) {
        total += estimateValueBytes(block.providerFileIds, 1, seen);
      }
      break;
    case 'tool_call':
      total += requiredStringBytes(block.name);
      total += requiredStringBytes(block.id);
      total += optionalStringBytes(block.description);
      total += estimateValueBytes(block.parameters, 1, seen);
      break;
    case 'tool_response':
      total += requiredStringBytes(block.toolName);
      total += requiredStringBytes(block.callId);
      total += optionalStringBytes(block.error);
      total += estimateValueBytes(block.result, 1, seen);
      break;
    default: {
      // Exhaustiveness guard: a new block type must be sized explicitly rather
      // than silently reported as zero.
      const exhaustive: never = block;
      void exhaustive;
    }
  }

  if (block.providerMetadata !== undefined) {
    total += estimateValueBytes(block.providerMetadata, 1, seen);
  }
  return total;
}

/** Estimated retained bytes of one content block in isolation. */
export function estimateBlockBytes(block: ContentBlock): number {
  return estimateBlockBytesTracked(block, new Set<object>());
}

/**
 * Estimated retained bytes of one history item against the shared tracker:
 * the item cell, the speaker string, every block (through the blocks array,
 * itself identity-tracked), and the item's own metadata (ContentMetadata:
 * model, usage, chronology, provider fields, ...), which is genuine retained
 * content. An item or blocks array already seen in this traversal contributes
 * nothing beyond having been counted at its first reference.
 */
export function estimateContentBytesTracked(
  content: IContent,
  seen: Set<object>,
): number {
  if (seen.has(content)) {
    return 0;
  }
  seen.add(content);
  let total = VALUE_OVERHEAD_BYTES;
  total += requiredStringBytes(content.speaker);
  if (!seen.has(content.blocks)) {
    seen.add(content.blocks);
    for (const block of content.blocks) {
      total += estimateBlockBytesTracked(block, seen);
    }
  }
  if (content.metadata !== undefined) {
    total += estimateValueBytes(content.metadata, 0, seen);
  }
  return total;
}

/** Estimated retained bytes of one history item, starting a fresh cycle set. */
export function estimateContentBytes(content: IContent): number {
  return estimateContentBytesTracked(content, new Set<object>());
}

/** A single tool response ranked by retained size. */
export interface ToolResponseSize {
  readonly toolName: string;
  readonly callId: string;
  readonly bytes: number;
  /** Index into the history array, so a caller can locate the item. */
  readonly historyIndex: number;
}

/** Retained-size breakdown of a whole history array. */
export interface HistorySizeBreakdown {
  readonly totalBytes: number;
  readonly itemCount: number;
  /** Bytes attributed to each block type, keyed by `ContentBlock['type']`. */
  readonly bytesByBlockType: Readonly<Record<string, number>>;
  /** Block counts per type, so bytes can be read against volume. */
  readonly countsByBlockType: Readonly<Record<string, number>>;
  /** Bytes attributed to each tool, largest first. */
  readonly bytesByToolName: Readonly<Record<string, number>>;
  /**
   * The heaviest individual tool responses, largest first. Bounded working
   * storage: at most `topN` responses are ever held or sorted, regardless of
   * how many tool responses the history contains.
   */
  readonly largestToolResponses: readonly ToolResponseSize[];
}

/** How many individual tool responses to rank. */
const DEFAULT_TOP_N = 10;

/**
 * Records one response into the bounded top-N tracker. `sorted` is kept
 * ascending by bytes; when full, an entry replaces the current smallest only
 * if it is heavier. Working storage is O(topN), never O(responses).
 */
function recordBounded(
  sorted: ToolResponseSize[],
  entry: ToolResponseSize,
  capacity: number,
): void {
  if (capacity <= 0) {
    return;
  }
  if (sorted.length < capacity) {
    let i = sorted.length;
    sorted.push(entry);
    while (i > 0 && sorted[i - 1].bytes > entry.bytes) {
      sorted[i] = sorted[i - 1];
      sorted[i - 1] = entry;
      i -= 1;
    }
    return;
  }
  if (entry.bytes <= sorted[0].bytes) {
    return;
  }
  sorted[0] = entry;
  let i = 0;
  while (i + 1 < sorted.length && sorted[i + 1].bytes < entry.bytes) {
    sorted[i] = sorted[i + 1];
    sorted[i + 1] = entry;
    i += 1;
  }
}

/**
 * Accumulating buckets for one breakdown traversal, shared by the per-item
 * and per-block helpers below.
 */
interface Accumulators {
  totalBytes: number;
  bytesByBlockType: Record<string, number>;
  countsByBlockType: Record<string, number>;
  bytesByToolName: Record<string, number>;
  topResponses: ToolResponseSize[];
}

/** Records one block's bytes into the attribution buckets. */
function recordBlock(
  block: ContentBlock,
  bytes: number,
  historyIndex: number,
  topN: number,
  acc: Accumulators,
): void {
  acc.totalBytes += bytes;
  acc.bytesByBlockType[block.type] =
    (acc.bytesByBlockType[block.type] ?? 0) + bytes;
  acc.countsByBlockType[block.type] =
    (acc.countsByBlockType[block.type] ?? 0) + 1;
  if (block.type !== 'tool_response') {
    return;
  }
  acc.bytesByToolName[block.toolName] =
    (acc.bytesByToolName[block.toolName] ?? 0) + bytes;
  recordBounded(
    acc.topResponses,
    {
      toolName: block.toolName,
      callId: block.callId,
      bytes,
      historyIndex,
    },
    topN,
  );
}

/** Walks one not-yet-seen item: speaker, blocks (identity-tracked), metadata. */
function accumulateItem(
  content: IContent,
  historyIndex: number,
  topN: number,
  seen: Set<object>,
  acc: Accumulators,
): void {
  acc.totalBytes += VALUE_OVERHEAD_BYTES;
  acc.totalBytes += requiredStringBytes(content.speaker);
  // A blocks array already counted under another (aliasing) item is skipped;
  // its blocks were attributed at their first reference.
  if (!seen.has(content.blocks)) {
    seen.add(content.blocks);
    for (const block of content.blocks) {
      if (seen.has(block)) {
        continue;
      }
      recordBlock(
        block,
        estimateBlockBytesTracked(block, seen),
        historyIndex,
        topN,
        acc,
      );
    }
  }
  if (content.metadata !== undefined) {
    acc.totalBytes += estimateValueBytes(content.metadata, 0, seen);
  }
}

/**
 * Size the retained history: totals, per-block-type attribution, per-tool
 * attribution, and the heaviest individual tool responses.
 *
 * One identity set spans the whole traversal — items, blocks arrays, blocks,
 * metadata, payloads — so a result object referenced by two blocks is counted
 * once (at its first reference) and attributed there. Attribution buckets are
 * subsets of the total (item overhead, speaker strings, and item metadata are
 * attributed to none of them) and are not expected to sum exactly to
 * `totalBytes`.
 *
 * This is the answer to "what is in the heap" in application terms — a tool
 * name and a byte count rather than an object-class histogram.
 */
export function computeHistorySizeBreakdown(
  history: readonly IContent[],
  topN: number = DEFAULT_TOP_N,
): HistorySizeBreakdown {
  const seen = new Set<object>();
  // The item cell, speaker, and metadata are part of the retained total but
  // belong to no block-type or tool bucket.
  const acc: Accumulators = {
    totalBytes: 0,
    bytesByBlockType: {},
    countsByBlockType: {},
    bytesByToolName: {},
    topResponses: [],
  };

  for (let index = 0; index < history.length; index++) {
    const content = history[index];
    if (seen.has(content)) {
      continue;
    }
    seen.add(content);
    accumulateItem(content, index, topN, seen, acc);
  }

  return {
    totalBytes: acc.totalBytes,
    itemCount: history.length,
    bytesByBlockType: acc.bytesByBlockType,
    countsByBlockType: acc.countsByBlockType,
    bytesByToolName: acc.bytesByToolName,
    // Ascending tracker -> descending ranking.
    largestToolResponses: acc.topResponses.reverse(),
  };
}
