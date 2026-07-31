/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Release of in-flight stream state on abnormal paths (issue #2852).
 *
 * The accumulation tests cover the normal terminal path. A long-running session
 * also cancels turns, hits provider errors, and sees streams that stop without
 * a finish chunk. On every one of those paths the blocks accumulated so far
 * must be released rather than carried into the next turn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamProcessor } from './StreamProcessor.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

function makeChunk(text: string): ModelStreamChunk {
  return toModelStreamChunk({
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
  } as IContent);
}

function makeFinishChunk(text: string): ModelStreamChunk {
  return toModelStreamChunk({
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { stopReason: 'STOP' },
  } as IContent);
}

function createUserInput(): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Hi' }],
  } as IContent;
}

function collectFinalizedText(finalize: ReturnType<typeof vi.fn>): string[] {
  return finalize.mock.calls.map((call) => {
    const output = call[0] as { content: { blocks: Array<{ text?: string }> } };
    return output.content.blocks.map((block) => block.text ?? '').join('');
  });
}

describe('StreamProcessor.processStreamResponse — stream state release (#2852)', () => {
  let processor: StreamProcessor;
  let finalize: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    processor = Object.create(StreamProcessor.prototype);
    Object.assign(processor, {
      runtimeContext: {
        ephemerals: { reasoning: { includeInContext: () => false } },
      },
      compressionHandler: { lastPromptTokenCount: 0 },
      conversationManager: {
        recordHistory: vi.fn(),
        recordStreamingHistory: vi.fn(),
      },
      historyService: {
        add: vi.fn(),
        getAll: () => [],
        waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
      },
      logger: new DebugLogger('test'),
      eagerlyRecordedToolResponseCallIds: new Set<string>(),
    });
    finalize = vi.fn().mockResolvedValue(undefined);
    (processor as unknown as Record<string, unknown>)[
      '_finalizeStreamProcessing'
    ] = finalize;
  });

  it('does not carry cancelled blocks into the next turn', async () => {
    async function* cancelledStream(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('cancelled-a');
      yield makeChunk('cancelled-b');
      yield makeChunk('cancelled-c');
    }

    // The consumer abandons the stream part-way, as a turn cancellation does.
    const iterator = processor.processStreamResponse(
      cancelledStream(),
      createUserInput(),
    );
    await iterator.next();
    await iterator.return(undefined as never);

    async function* nextStream(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('fresh-');
      yield makeFinishChunk('turn');
    }
    for await (const _chunk of processor.processStreamResponse(
      nextStream(),
      createUserInput(),
    )) {
      // drain
    }

    expect(collectFinalizedText(finalize)).toStrictEqual(['fresh-turn']);
  });

  it('does not carry blocks from an errored stream into the next turn', async () => {
    async function* failingStream(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('errored-a');
      yield makeChunk('errored-b');
      throw new Error('provider exploded');
    }

    await expect(
      (async () => {
        for await (const _chunk of processor.processStreamResponse(
          failingStream(),
          createUserInput(),
        )) {
          // drain
        }
      })(),
    ).rejects.toThrow('provider exploded');

    // A stream that failed must not be finalized with partial output.
    expect(finalize).not.toHaveBeenCalled();

    async function* nextStream(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('recovered-');
      yield makeFinishChunk('turn');
    }
    for await (const _chunk of processor.processStreamResponse(
      nextStream(),
      createUserInput(),
    )) {
      // drain
    }

    expect(collectFinalizedText(finalize)).toStrictEqual(['recovered-turn']);
  });

  it('finalizes a stalled stream with only its own blocks', async () => {
    // A stream that ends without a finish chunk (idle timeout, truncated
    // response) still completes the generator, so it is finalized — but it must
    // not pick up anything from a previous turn.
    async function* firstStalled(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('stalled-one');
    }
    for await (const _chunk of processor.processStreamResponse(
      firstStalled(),
      createUserInput(),
    )) {
      // drain
    }

    async function* secondStalled(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('stalled-two');
    }
    for await (const _chunk of processor.processStreamResponse(
      secondStalled(),
      createUserInput(),
    )) {
      // drain
    }

    expect(collectFinalizedText(finalize)).toStrictEqual([
      'stalled-one',
      'stalled-two',
    ]);
  });

  it('keeps concurrent streams from sharing accumulated blocks', async () => {
    async function* streamOf(prefix: string): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk(`${prefix}-a`);
      yield makeFinishChunk(`${prefix}-b`);
    }

    await Promise.all(
      ['left', 'right'].map(async (prefix) => {
        for await (const _chunk of processor.processStreamResponse(
          streamOf(prefix),
          createUserInput(),
        )) {
          // drain
        }
      }),
    );

    expect(collectFinalizedText(finalize).sort()).toStrictEqual([
      'left-aleft-b',
      'right-aright-b',
    ]);
  });
});
