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
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

function createMockRuntimeContext() {
  return {
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

function createMockHistoryService() {
  return {
    add: vi.fn(),
    getAll: () => [],
    generateTurnKey: () => `turn-${crypto.randomUUID()}`,
    waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
  };
}

function makeChunk(text: string): ModelStreamChunk {
  return toModelStreamChunk({
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
  } as IContent);
}

function makeFinishChunk(text: string, finishReason: string): ModelStreamChunk {
  return toModelStreamChunk({
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { stopReason: finishReason },
  } as IContent);
}

function createUserInput(): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Hi' }],
  } as IContent;
}

describe('StreamProcessor.processStreamResponse — accumulation efficiency (#2852)', () => {
  let processor: StreamProcessor;

  beforeEach(() => {
    processor = Object.create(StreamProcessor.prototype);
    Object.assign(processor, {
      runtimeContext: createMockRuntimeContext(),
      compressionHandler: createMockCompressionHandler(),
      conversationManager: createMockConversationManager(),
      historyService: createMockHistoryService(),
      logger: new DebugLogger('test'),
      eagerlyRecordedToolResponseCallIds: new Set<string>(),
    });
    (processor as unknown as Record<string, unknown>)[
      '_finalizeStreamProcessing'
    ] = vi.fn().mockResolvedValue(undefined);
  });

  it('produces correct final accumulated output with many text chunks', async () => {
    const chunkCount = 500;
    const words: string[] = [];
    for (let i = 0; i < chunkCount; i++) {
      words.push(`word${i}`);
    }

    async function* largeStream(): AsyncGenerator<ModelStreamChunk> {
      for (let i = 0; i < chunkCount; i++) {
        yield makeChunk(words[i]);
      }
      yield makeFinishChunk('END', 'STOP');
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

    expect(yielded).toStrictEqual([...words, 'END']);
  });

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

  it('does not grow quadratically — large stream completes in bounded time', async () => {
    // The O(N²) defect: accumulateModelStreamChunk creates a new blocks
    // array containing ALL prior blocks plus the new chunk on every call.
    // At chunk i, a new array of length i+1 is allocated. Total copies:
    // N*(N+1)/2. For N=20000 that's 200M copies, taking ~2.8s in V8.
    //
    // The fix collects chunk blocks in an append-only list and materializes
    // the full accumulated output once, achieving O(N).
    //
    // We use 100-char payloads so block objects are non-trivial, making
    // the timing difference between O(N²) (~1.4s) and O(N) (<10ms)
    // clearly discriminating.
    const chunkCount = 20000;
    const payload = 'x'.repeat(100);

    async function* hugeStream(): AsyncGenerator<ModelStreamChunk> {
      for (let i = 0; i < chunkCount; i++) {
        yield makeChunk(payload);
      }
      yield makeFinishChunk('', 'STOP');
    }

    const start = performance.now();
    let yieldedCount = 0;
    for await (const _chunk of processor.processStreamResponse(
      hugeStream(),
      createUserInput(),
    )) {
      yieldedCount++;
    }
    const elapsed = performance.now() - start;

    expect(yieldedCount).toBe(chunkCount + 1);
    // O(N²) takes ~2800ms for 20000 chunks. O(N) takes <50ms.
    // 500ms threshold gives 10x headroom over O(N) while clearly
    // rejecting O(N²) behavior.
    expect(elapsed).toBeLessThan(500);
  });

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
      yield makeFinishChunk('', 'STOP');
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
      runtimeContext: {
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
      yield makeFinishChunk('', 'STOP');
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
