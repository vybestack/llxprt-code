/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ModelStreamChunk,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  emptyModelOutput,
  accumulateModelStreamChunk,
} from '@vybestack/llxprt-code-core/llm-types/index.js';

/**
 * Collects a streamed response into a single {@link ModelOutput}.
 *
 * `accumulateModelStreamChunk` rebuilds the block array on every chunk with
 * `[...acc.blocks, ...chunk.blocks]`, so folding a response of B blocks through
 * it directly costs O(B^2) copies (issue #2852). Blocks are appended to one
 * array here and attached to the envelope once, at the end.
 *
 * State is per-instance and per-stream, so a cancelled, errored, or stalled
 * stream releases everything it had collected rather than carrying it into the
 * next turn.
 */
export class StreamOutputAccumulator {
  private envelope: ModelOutput = emptyModelOutput();
  private readonly blocks: ModelStreamChunk['content']['blocks'] = [];

  add(chunk: ModelStreamChunk): void {
    for (const block of chunk.content.blocks) {
      this.blocks.push(block);
    }
    this.envelope = accumulateModelStreamChunk(this.envelope, {
      ...chunk,
      content: { ...chunk.content, blocks: [] },
    });
  }

  materialize(): ModelOutput {
    return {
      ...this.envelope,
      content: { ...this.envelope.content, blocks: this.blocks },
    };
  }
}
