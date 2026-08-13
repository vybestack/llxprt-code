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
 * 1. Allocation-free. `ToolCallBlock.parameters` and `ToolResponseBlock.result`
 *    are `unknown` (arbitrary JSON). The obvious implementation,
 *    `JSON.stringify(value).length`, allocates a full copy of the value being
 *    measured — on a multi-GB history that is precisely the thing we must not
 *    do. Everything here walks structure and accumulates a number instead.
 *
 * 2. O(1) per string. String cost is derived from `.length`, never by scanning
 *    characters, so sizing a large history stays proportional to the number of
 *    *values* rather than the number of *bytes*.
 *
 * 3. Cycle-safe and depth-capped. Provider metadata is untrusted in shape and
 *    may be self-referential; a naive recursive walk would not terminate.
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
 * `seen` breaks reference cycles. Note that it also causes a value referenced
 * twice to be counted once, which is correct for retention: the heap holds one
 * copy.
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
  for (const [key, entry] of Object.entries(value)) {
    total += key.length * BYTES_PER_CHAR;
    total += estimateValueBytes(entry, depth + 1, seen);
  }
  return total;
}

/** Estimated retained bytes of a single value, starting a fresh cycle set. */
export function estimateBytes(value: unknown): number {
  return estimateValueBytes(value, 0, new Set<object>());
}

/** Estimated retained bytes of one content block, including its metadata. */
export function estimateBlockBytes(block: ContentBlock): number {
  const seen = new Set<object>();
  let total = VALUE_OVERHEAD_BYTES;

  switch (block.type) {
    case 'text':
      total += block.text.length * BYTES_PER_CHAR;
      break;
    case 'code':
      total += block.code.length * BYTES_PER_CHAR;
      break;
    case 'thinking':
      total += block.thought.length * BYTES_PER_CHAR;
      total += (block.encryptedContent?.length ?? 0) * BYTES_PER_CHAR;
      total += (block.signature?.length ?? 0) * BYTES_PER_CHAR;
      break;
    case 'media':
      // `data` is the payload: a base64 body or a URL.
      total += block.data.length * BYTES_PER_CHAR;
      total += (block.caption?.length ?? 0) * BYTES_PER_CHAR;
      break;
    case 'tool_call':
      total += block.name.length * BYTES_PER_CHAR;
      total += estimateValueBytes(block.parameters, 1, seen);
      break;
    case 'tool_response':
      total += block.toolName.length * BYTES_PER_CHAR;
      total += estimateValueBytes(block.result, 1, seen);
      total += (block.error?.length ?? 0) * BYTES_PER_CHAR;
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

/** Estimated retained bytes of one history item. */
export function estimateContentBytes(content: IContent): number {
  let total = VALUE_OVERHEAD_BYTES;
  for (const block of content.blocks) {
    total += estimateBlockBytes(block);
  }
  return total;
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
  /** The heaviest individual tool responses, largest first. */
  readonly largestToolResponses: readonly ToolResponseSize[];
}

/** How many individual tool responses to rank. */
const DEFAULT_TOP_N = 10;

function rankBySize(
  responses: ToolResponseSize[],
  topN: number,
): ToolResponseSize[] {
  return responses.sort((a, b) => b.bytes - a.bytes).slice(0, topN);
}

/**
 * Size the retained history: totals, per-block-type attribution, per-tool
 * attribution, and the heaviest individual tool responses.
 *
 * This is the answer to "what is in the heap" in application terms — a tool
 * name and a byte count rather than an object-class histogram.
 */
export function computeHistorySizeBreakdown(
  history: readonly IContent[],
  topN: number = DEFAULT_TOP_N,
): HistorySizeBreakdown {
  const bytesByBlockType: Record<string, number> = {};
  const countsByBlockType: Record<string, number> = {};
  const bytesByToolName: Record<string, number> = {};
  const toolResponses: ToolResponseSize[] = [];
  let totalBytes = 0;

  for (let index = 0; index < history.length; index++) {
    const content = history[index];
    totalBytes += VALUE_OVERHEAD_BYTES;
    for (const block of content.blocks) {
      const bytes = estimateBlockBytes(block);
      totalBytes += bytes;
      bytesByBlockType[block.type] = (bytesByBlockType[block.type] ?? 0) + bytes;
      countsByBlockType[block.type] = (countsByBlockType[block.type] ?? 0) + 1;

      if (block.type === 'tool_response') {
        bytesByToolName[block.toolName] =
          (bytesByToolName[block.toolName] ?? 0) + bytes;
        toolResponses.push({
          toolName: block.toolName,
          callId: block.callId,
          bytes,
          historyIndex: index,
        });
      }
    }
  }

  return {
    totalBytes,
    itemCount: history.length,
    bytesByBlockType,
    countsByBlockType,
    bytesByToolName,
    largestToolResponses: rankBySize(toolResponses, topN),
  };
}
