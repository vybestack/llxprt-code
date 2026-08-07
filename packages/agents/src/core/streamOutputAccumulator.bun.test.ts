/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for StreamOutputAccumulator thinking-block coalescing
 * (issue #3111).
 *
 * Anthropic streams re-emit the *full accumulated* thought on every
 * `thinking_delta` (streamStatus: 'delta'), then a single
 * streamStatus: 'complete' block closes the span. The accumulator must keep
 * only the latest block per `streamId` (see IContent.ThinkingBlock) instead of
 * appending every delta, otherwise a long session retains N copies of an
 * O(L)-byte thought per span — unbounded growth.
 *
 * These tests exercise the public add()/materialize() API with real blocks; no
 * component is mocked.
 *
 * @plan issue3111
 */

import { describe, it, expect } from 'bun:test';
import type {
  ModelStreamChunk,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type {
  ThinkingBlock,
  TextBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { StreamOutputAccumulator } from './streamOutputAccumulator.js';

function chunk(
  blocks: ModelStreamChunk['content']['blocks'],
): ModelStreamChunk {
  return { content: { speaker: 'ai', blocks } };
}

function thinking(partial: {
  thought: string;
  streamId: string;
  streamStatus: 'delta' | 'complete';
  signature?: string;
  encryptedContent?: string;
}): ThinkingBlock {
  return { type: 'thinking', sourceField: 'thinking', ...partial };
}

function text(t: string): TextBlock {
  return { type: 'text', text: t };
}

function thinkingBlocks(output: ModelOutput): ThinkingBlock[] {
  return output.content.blocks.filter(
    (b): b is ThinkingBlock => b.type === 'thinking',
  );
}

describe('StreamOutputAccumulator thinking-block coalescing (issue #3111)', () => {
  it('accumulates non-thinking blocks verbatim and in order', () => {
    const accumulator = new StreamOutputAccumulator();
    accumulator.add(chunk([text('Hello')]));
    accumulator.add(chunk([text(' world')]));
    accumulator.add(
      chunk([{ type: 'tool_call', id: 't1', name: 'ls', parameters: {} }]),
    );

    const result = accumulator.materialize();
    expect(result.content.blocks).toHaveLength(3);
    expect(result.content.speaker).toBe('ai');
  });

  it('coalesces the delta updates of one thinking span into a single block', () => {
    const accumulator = new StreamOutputAccumulator();
    const streamId = 'anthropic-thinking:0:block-0';
    // Simulate the leaky emission: each delta carries the full-so-far thought.
    accumulator.add(
      chunk([thinking({ thought: 'One', streamId, streamStatus: 'delta' })]),
    );
    accumulator.add(
      chunk([
        thinking({ thought: 'One Two', streamId, streamStatus: 'delta' }),
      ]),
    );
    accumulator.add(
      chunk([
        thinking({ thought: 'One Two Three', streamId, streamStatus: 'delta' }),
      ]),
    );
    // The closing block carries the final signature.
    accumulator.add(
      chunk([
        thinking({
          thought: 'One Two Three',
          streamId,
          streamStatus: 'complete',
          signature: 'sig-0',
        }),
      ]),
    );

    const blocks = thinkingBlocks(accumulator.materialize());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].thought).toBe('One Two Three');
    expect(blocks[0].streamStatus).toBe('complete');
    expect(blocks[0].signature).toBe('sig-0');
  });

  it('coalesces each thinking span independently and preserves span order', () => {
    const accumulator = new StreamOutputAccumulator();
    const a = 'anthropic-thinking:0:block-0';
    const b = 'anthropic-thinking:0:block-1';
    accumulator.add(chunk([text('start')]));
    accumulator.add(
      chunk([thinking({ thought: 'A1', streamId: a, streamStatus: 'delta' })]),
    );
    accumulator.add(
      chunk([thinking({ thought: 'B1', streamId: b, streamStatus: 'delta' })]),
    );
    accumulator.add(
      chunk([thinking({ thought: 'A2', streamId: a, streamStatus: 'delta' })]),
    );
    accumulator.add(
      chunk([thinking({ thought: 'B2', streamId: b, streamStatus: 'delta' })]),
    );
    accumulator.add(
      chunk([
        thinking({
          thought: 'A2',
          streamId: a,
          streamStatus: 'complete',
          signature: 'sa',
        }),
      ]),
    );
    accumulator.add(
      chunk([
        thinking({
          thought: 'B2',
          streamId: b,
          streamStatus: 'complete',
          signature: 'sb',
        }),
      ]),
    );
    accumulator.add(chunk([text('end')]));

    const result = accumulator.materialize();
    // Order: start, thinking-a, thinking-b, end  (each span keeps its first position).
    expect(result.content.blocks.map((b) => b.type)).toEqual([
      'text',
      'thinking',
      'thinking',
      'text',
    ]);
    const spans = thinkingBlocks(result);
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({
      streamId: a,
      thought: 'A2',
      signature: 'sa',
    });
    expect(spans[1]).toMatchObject({
      streamId: b,
      thought: 'B2',
      signature: 'sb',
    });
  });

  it('bounds retained thinking to one block regardless of delta count', () => {
    const accumulator = new StreamOutputAccumulator();
    const streamId = 'anthropic-thinking:0:block-0';
    const deltaCount = 250;
    for (let i = 1; i <= deltaCount; i++) {
      accumulator.add(
        chunk([
          thinking({
            thought: `delta ${i}`.repeat(1000),
            streamId,
            streamStatus: 'delta',
          }),
        ]),
      );
    }
    accumulator.add(
      chunk([
        thinking({
          thought: 'final',
          streamId,
          streamStatus: 'complete',
          signature: 's',
        }),
      ]),
    );

    const blocks = thinkingBlocks(accumulator.materialize());
    // Before the fix this was deltaCount + 1 blocks; it must be exactly one.
    expect(blocks).toHaveLength(1);
    expect(blocks[0].thought).toBe('final');
  });

  it('coalesces both Anthropic and OpenAI-Responses streamId formats', () => {
    // The accumulator is provider-agnostic: it matches the streamId string, so
    // both critical reasoning emitters collapse each span to its final block:
    //   - Anthropic: `anthropic-thinking:<src>:block-<n>` (complete carries signature)
    //   - OpenAI Responses: `openai-responses-reasoning:<n>` (complete carries encryptedContent)
    const accumulator = new StreamOutputAccumulator();
    const anthropic = 'anthropic-thinking:0:block-0';
    const responses = 'openai-responses-reasoning:0';

    accumulator.add(
      chunk([
        thinking({
          thought: 'A-1',
          streamId: anthropic,
          streamStatus: 'delta',
        }),
      ]),
    );
    accumulator.add(
      chunk([
        thinking({
          thought: 'A-1 A-2',
          streamId: anthropic,
          streamStatus: 'delta',
        }),
      ]),
    );
    accumulator.add(
      chunk([
        thinking({
          thought: 'A-1 A-2',
          streamId: anthropic,
          streamStatus: 'complete',
          signature: 'sig-A',
        }),
      ]),
    );

    accumulator.add(
      chunk([
        thinking({
          thought: 'R-1',
          streamId: responses,
          streamStatus: 'delta',
        }),
      ]),
    );
    accumulator.add(
      chunk([
        thinking({
          thought: 'R-1 R-2',
          streamId: responses,
          streamStatus: 'delta',
        }),
      ]),
    );
    accumulator.add(
      chunk([
        thinking({
          thought: 'R-1 R-2',
          streamId: responses,
          streamStatus: 'complete',
          encryptedContent: 'enc-R',
        }),
      ]),
    );

    const spans = thinkingBlocks(accumulator.materialize());
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({
      streamId: anthropic,
      thought: 'A-1 A-2',
      signature: 'sig-A',
      streamStatus: 'complete',
    });
    expect(spans[1]).toMatchObject({
      streamId: responses,
      thought: 'R-1 R-2',
      encryptedContent: 'enc-R',
      streamStatus: 'complete',
    });
  });

  it('appends (does not coalesce) thinking blocks that lack a streamId', () => {
    const accumulator = new StreamOutputAccumulator();
    // No streamId -> the coalescing guard (typeof streamId === 'string') is
    // false, so each block is appended verbatim. This is the fallback path for
    // providers that emit thinking without streaming metadata.
    accumulator.add(
      chunk([{ type: 'thinking', sourceField: 'thinking', thought: 'A' }]),
    );
    accumulator.add(
      chunk([{ type: 'thinking', sourceField: 'thinking', thought: 'B' }]),
    );

    const blocks = thinkingBlocks(accumulator.materialize());
    expect(blocks).toHaveLength(2);
    expect(blocks[0].thought).toBe('A');
    expect(blocks[1].thought).toBe('B');
  });

  it('retains the last delta when a thinking span never receives complete', () => {
    const accumulator = new StreamOutputAccumulator();
    const streamId = 'anthropic-thinking:0:block-0';
    // Stream interrupted/errored before the closing complete block arrives.
    accumulator.add(
      chunk([
        thinking({ thought: 'partial', streamId, streamStatus: 'delta' }),
      ]),
    );
    accumulator.add(
      chunk([
        thinking({ thought: 'partial more', streamId, streamStatus: 'delta' }),
      ]),
    );

    const blocks = thinkingBlocks(accumulator.materialize());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].thought).toBe('partial more');
    expect(blocks[0].streamStatus).toBe('delta');
  });
});
