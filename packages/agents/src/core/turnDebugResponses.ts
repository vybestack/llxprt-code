/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Bounded retention of streamed chunks for diagnostics.
 *
 * `Turn` keeps the chunks it has seen so error reports can show what the model
 * actually sent. That retention used to be unbounded and had no setting gating
 * it, so a runaway response grew it without limit (issue #3339). This owns the
 * bound, the thinking-block collapse, and the index that makes the collapse
 * cheap, so `Turn` does not carry the bookkeeping.
 */

import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Chunks retained for diagnostics.
 *
 * Error reports are already capped at 128 KiB, and only the tail of a stream
 * explains a failure, so retaining more than this buys nothing.
 */
export const MAX_DEBUG_RESPONSE_CHUNKS = 1024;

interface ThinkingLocation {
  readonly chunkIndex: number;
  readonly blockIndex: number;
}

/**
 * Collects streamed chunks for diagnostics under a hard retention bound.
 *
 * Two behaviours keep this from tracking the size of the response:
 *
 * Providers that re-emit an entire accumulated thought on every delta (notably
 * Anthropic) would otherwise leave one copy of an O(L) thought per delta. Each
 * `streamId` is collapsed to its latest block in place.
 *
 * Retention is capped. Trimming on every chunk past the cap would cost an
 * O(cap) front-splice plus an O(cap) index rebuild per chunk, which is O(n*cap)
 * over a stream and measured 12.2s / 407M operations for 200k chunks: a CPU
 * stall in place of the memory blowup. Letting the array reach twice the cap
 * and then dropping a full cap's worth in one batch amortises to O(1) per
 * chunk, measured at 23ms / 397k operations for the same input.
 */
export class TurnDebugResponses {
  private readonly chunks: ModelStreamChunk[] = [];
  private readonly thinkingByStreamId = new Map<string, ThinkingLocation>();

  /** Retained chunks, oldest first. */
  get retained(): readonly ModelStreamChunk[] {
    return this.chunks;
  }

  get length(): number {
    return this.chunks.length;
  }

  /**
   * Records `allowedBlocks` from `chunk`, replacing any thinking block that
   * continues a `streamId` already retained rather than appending a new copy.
   */
  push(chunk: ModelStreamChunk, allowedBlocks: ContentBlock[]): void {
    const blocksToAppend = allowedBlocks.filter(
      (block) => !this.tryReplaceThinkingBlock(chunk, block),
    );

    // An empty allowed set still records the chunk: a chunk whose blocks were
    // all filtered out is itself worth seeing in a report.
    if (blocksToAppend.length === 0 && allowedBlocks.length > 0) {
      return;
    }

    const chunkIndex = this.chunks.length;
    this.chunks.push({
      ...chunk,
      content: { ...chunk.content, blocks: blocksToAppend },
    });
    for (const [blockIndex, block] of blocksToAppend.entries()) {
      const streamId = TurnDebugResponses.thinkingStreamId(block);
      if (streamId !== undefined) {
        this.thinkingByStreamId.set(streamId, { chunkIndex, blockIndex });
      }
    }
    this.trim();
  }

  /**
   * Replaces the retained block for this block's thinking span, reporting
   * whether it did. Returns false for anything that is not a continuation of a
   * span already held.
   */
  private tryReplaceThinkingBlock(
    chunk: ModelStreamChunk,
    block: ContentBlock,
  ): boolean {
    const streamId = TurnDebugResponses.thinkingStreamId(block);
    if (streamId === undefined) {
      return false;
    }
    const location = this.thinkingByStreamId.get(streamId);
    if (location === undefined) {
      return false;
    }
    // The index is rebuilt whenever chunks are dropped, so a recorded location
    // always addresses a live chunk.
    const existing = this.chunks[location.chunkIndex];
    const blocks = [...existing.content.blocks];
    blocks[location.blockIndex] = block;
    this.chunks[location.chunkIndex] = {
      ...chunk,
      content: { ...chunk.content, blocks },
    };
    return true;
  }

  /** The block's thinking-span id, or undefined if it does not carry one. */
  private static thinkingStreamId(block: ContentBlock): string | undefined {
    return block.type === 'thinking' && typeof block.streamId === 'string'
      ? block.streamId
      : undefined;
  }

  /** Drops the oldest chunks once retention passes the high-water mark. */
  private trim(): void {
    if (this.chunks.length <= MAX_DEBUG_RESPONSE_CHUNKS * 2) {
      return;
    }
    this.chunks.splice(0, this.chunks.length - MAX_DEBUG_RESPONSE_CHUNKS);
    this.rebuildThinkingIndex();
  }

  private rebuildThinkingIndex(): void {
    this.thinkingByStreamId.clear();
    for (const [chunkIndex, chunk] of this.chunks.entries()) {
      for (const [blockIndex, block] of chunk.content.blocks.entries()) {
        const streamId = TurnDebugResponses.thinkingStreamId(block);
        if (streamId !== undefined) {
          this.thinkingByStreamId.set(streamId, { chunkIndex, blockIndex });
        }
      }
    }
  }
}
