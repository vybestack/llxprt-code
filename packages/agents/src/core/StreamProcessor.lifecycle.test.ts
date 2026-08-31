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
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { StreamProcessor } from './StreamProcessor.js';
import { StreamOutputAccumulator } from './streamOutputAccumulator.js';
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
        generateTurnKey: () => `turn-${crypto.randomUUID()}`,
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
    await iterator.return(undefined);

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

  it('appends blocks in place instead of copying them per chunk', () => {
    // The envelope is folded with an empty block list, so the fold is constant
    // work per chunk and every block lands in one array. Array identity is a
    // deterministic witness for that, unlike an elapsed-time threshold.
    const accumulator = new StreamOutputAccumulator();
    for (let index = 0; index < 5_000; index += 1) {
      accumulator.add(makeChunk(`chunk-${index}`));
    }

    const first = accumulator.materialize();
    const second = accumulator.materialize();
    expect({
      sameBlockArray: first.content.blocks === second.content.blocks,
      blockCount: first.content.blocks.length,
    }).toStrictEqual({ sameBlockArray: true, blockCount: 5_000 });
  });

  it('threads each concurrent stream immutable turn identity through media admission', async () => {
    const admittedTurnByText = new Map<string, string>();
    Reflect.set(processor, 'runtimeContext', {
      ephemerals: { reasoning: { includeInContext: () => false } },
      mediaAdmission: {
        admitContent: (
          content: IContent,
          context: { readonly turnId: string },
        ): Promise<IContent> => {
          const text = content.blocks.find(
            (block) => block.type === 'text',
          )?.text;
          if (text !== undefined) admittedTurnByText.set(text, context.turnId);
          return Promise.resolve(content);
        },
        admitContents: (contents: readonly IContent[]): Promise<IContent[]> =>
          Promise.resolve([...contents]),
      },
    });

    async function* streamOf(prefix: string): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk(`${prefix}-first`);
      await Promise.resolve();
      yield makeFinishChunk(`${prefix}-last`);
    }
    const left = processor.processStreamResponse(
      streamOf('left'),
      createUserInput(),
      undefined,
      'turn-left',
    );
    await left.next();
    const right = processor.processStreamResponse(
      streamOf('right'),
      createUserInput(),
      undefined,
      'turn-right',
    );

    await Promise.all([
      (async () => {
        for await (const _chunk of left) {
          // drain
        }
      })(),
      (async () => {
        for await (const _chunk of right) {
          // drain
        }
      })(),
    ]);

    expect(Object.fromEntries(admittedTurnByText)).toStrictEqual({
      'left-first': 'turn-left',
      'left-last': 'turn-left',
      'right-first': 'turn-right',
      'right-last': 'turn-right',
    });
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
