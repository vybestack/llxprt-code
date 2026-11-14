/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for StreamProcessor.processStreamResponse accumulation
 * efficiency (issue #2852).
 *
 * The core defect: accumulateModelStreamChunk copies ALL previously
 * accumulated blocks on each chunk via `[...acc.content.blocks, ...chunk.content.blocks]`,
 * producing O(N²) total block copies for N chunks.
 *
 * The fix: processStreamResponse must collect chunk blocks without
 * re-copying the entire prior accumulation on each delta, materializing
 * the full accumulated output once at terminal.
 *
 * These tests verify behavioral correctness (final output) and efficiency
 * (no quadratic growth) using real chunk streams.
 */
import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { StreamProcessor } from './StreamProcessor.js';
import { arrivalHistoryFixture } from './__tests__/support/arrival-history-fixture.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

function createMockRuntimeContext() {
  return {
    state: { model: 'test' },
    ephemerals: {
      reasoning: {
        includeInContext: () => false,
      },
    },
  };
}

function createMockCompressionHandler() {
  return {
    lastPromptTokenCount: 0,
  };
}

function createMockConversationManager() {
  return {
    recordHistory: vi.fn(),
    recordStreamingHistory: vi.fn(),
  };
}

const createMockHistoryService = arrivalHistoryFixture();

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
    metadata: { finishReason: 'stop', rawStopReason: 'STOP' },
  } as IContent);
}

function createUserInput(): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Hi' }],
  } as IContent;
}

function createProcessor(): StreamProcessor {
  const created: StreamProcessor = Object.create(StreamProcessor.prototype);
  Object.assign(created, {
    ports: createMockRuntimeContext(),
    compressionHandler: createMockCompressionHandler(),
    conversationManager: createMockConversationManager(),
    historyService: createMockHistoryService(),
    logger: new DebugLogger('test'),
    eagerlyRecordedToolResponseCallIds: new Set<string>(),
    _finalizeStreamProcessing: vi.fn().mockResolvedValue(undefined),
  });
  return created;
}

/**
 * Streams `chunkCount` 100-char chunks plus a finish chunk through a fresh
 * processor and reports the CPU time this process spent doing it, including a
 * full collection of the garbage the stream produced. CPU time, unlike wall
 * time, does not grow while the runner schedules other jobs, and collecting
 * before and inside the measurement charges each run for its own garbage.
 */
async function measureStreamCpu(
  chunkCount: number,
): Promise<{ cpuMs: number; yieldedCount: number }> {
  const streamProcessor = createProcessor();
  const payload = 'x'.repeat(100);
  async function* stream(): AsyncGenerator<ModelStreamChunk> {
    for (let i = 0; i < chunkCount; i++) {
      yield makeChunk(payload);
    }
    yield makeFinishChunk('');
  }
  Bun.gc(true);
  const start = process.cpuUsage();
  let yieldedCount = 0;
  for await (const _chunk of streamProcessor.processStreamResponse(
    stream(),
    createUserInput(),
  )) {
    yieldedCount++;
  }
  Bun.gc(true);
  const used = process.cpuUsage(start);
  return { cpuMs: (used.user + used.system) / 1000, yieldedCount };
}

function median(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

let processor: StreamProcessor;

describe('StreamProcessor.processStreamResponse — accumulation efficiency (#2852)', () => {
  beforeEach(() => {
    processor = createProcessor();
  });
  it('produces correct final accumulated output with many text chunks', async () => {
    const { yielded, words } =
      await observeProducesCorrectFinalAccumulatedOutputWithManyTextChunks();
    expect(yielded).toStrictEqual([...words, 'END']);
  });

  const observeProducesCorrectFinalAccumulatedOutputWithManyTextChunks =
    async () => {
      const chunkCount = 500;
      const words: string[] = [];
      for (let i = 0; i < chunkCount; i++) {
        words.push(`word${i}`);
      }

      async function* largeStream(): AsyncGenerator<ModelStreamChunk> {
        for (let i = 0; i < chunkCount; i++) {
          yield makeChunk(words[i]);
        }
        yield makeFinishChunk('END');
      }

      const yielded: string[] = [];
      for await (const chunk of processor.processStreamResponse(
        largeStream(),
        createUserInput(),
      )) {
        for (const block of chunk.content.blocks) {
          if (block.type === 'text') {
            yielded.push(block.text);
          }
        }
      }

      return { yielded, words };
    };
  it('accumulates metadata from later chunks (finishReason, usage)', async () => {
    const usageChunk: ModelStreamChunk = {
      content: { speaker: 'ai', blocks: [] },
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    };

    async function* metaStream(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('text content');
      yield usageChunk;
    }

    for await (const _chunk of processor.processStreamResponse(
      metaStream(),
      createUserInput(),
    )) {
      // drain
    }

    const finalizeCall = (
      processor as unknown as {
        _finalizeStreamProcessing: ReturnType<typeof vi.fn>;
      }
    )._finalizeStreamProcessing.mock.calls[0];
    expect(finalizeCall).toBeDefined();
    const acc = finalizeCall[0];
    expect(acc.finishReason).toBe('stop');
    expect(acc.usage).toStrictEqual({
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
    });
  });
  it('does not grow quadratically — 4x the chunks costs about 4x the CPU time', async () => {
    // The O(N²) defect: accumulateModelStreamChunk built a new blocks array
    // containing ALL prior blocks plus the new chunk on every call, N*(N+1)/2
    // copies in total. Quadrupling the chunk count then multiplies the cost
    // by up to 16, while per-chunk (linear) processing multiplies it by at
    // most 4. A fixed wall-clock budget cannot tell these apart on a loaded CI
    // runner, so the test compares CPU time for N and 4N chunks measured in
    // the same process. The current linear processing measured 2.8 to 3.3,
    // idle and with every core saturated by competing processes; putting the
    // per-chunk copy of the accumulated blocks back into processStreamResponse
    // measured 8.6 to 8.9. The median of three interleaved rounds per size
    // keeps one disturbed sample from deciding the ratio.
    const smallCount = 10000;
    const largeCount = smallCount * 4;
    const rounds = 3;

    await measureStreamCpu(smallCount);
    const small: number[] = [];
    const large: number[] = [];
    for (let round = 0; round < rounds; round++) {
      const smallRun = await measureStreamCpu(smallCount);
      const largeRun = await measureStreamCpu(largeCount);
      expect(smallRun.yieldedCount).toBe(smallCount + 1);
      expect(largeRun.yieldedCount).toBe(largeCount + 1);
      small.push(smallRun.cpuMs);
      large.push(largeRun.cpuMs);
    }

    expect(median(large) / median(small)).toBeLessThan(6);
  }, 60_000);
  it('preserves block order across mixed block types', async () => {
    const textChunk = makeChunk('before');
    const toolCallChunk: ModelStreamChunk = toModelStreamChunk({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'test_tool',
          parameters: { input: 'value' },
        },
      ],
    } as IContent);
    const afterChunk = makeChunk('after');

    async function* mixedStream(): AsyncGenerator<ModelStreamChunk> {
      yield textChunk;
      yield toolCallChunk;
      yield afterChunk;
      yield makeFinishChunk('');
    }

    const types: string[] = [];
    for await (const chunk of processor.processStreamResponse(
      mixedStream(),
      createUserInput(),
    )) {
      for (const block of chunk.content.blocks) {
        types.push(block.type);
      }
    }

    expect(types).toStrictEqual(['text', 'tool_call', 'text', 'text']);
  });
  it('passes includeThoughts flag to finalize', async () => {
    processor = Object.create(StreamProcessor.prototype);
    Object.assign(processor, {
      ports: {
        state: { model: 'test' },
        ephemerals: {
          reasoning: {
            includeInContext: () => true,
          },
        },
      },
      compressionHandler: createMockCompressionHandler(),
      conversationManager: createMockConversationManager(),
      historyService: createMockHistoryService(),
      logger: new DebugLogger('test'),
      eagerlyRecordedToolResponseCallIds: new Set<string>(),
    });
    const finalizeMock = vi.fn().mockResolvedValue(undefined);
    (processor as unknown as Record<string, unknown>)[
      '_finalizeStreamProcessing'
    ] = finalizeMock;

    async function* tinyStream(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('a');
      yield makeFinishChunk('');
    }

    for await (const _chunk of processor.processStreamResponse(
      tinyStream(),
      createUserInput(),
    )) {
      // drain
    }

    expect(finalizeMock).toHaveBeenCalledTimes(1);
    const thirdArg = finalizeMock.mock.calls[0]?.[2];
    expect(thirdArg).toBe(true);
  });
});
