/**
 * Behavioral tests for StreamProcessor.processStreamResponse yield-as-you-go
 * streaming. Verifies the critical invariant that chunks are yielded inline
 * during iteration rather than buffered and emitted after the stream ends.
 *
 * @issue #1846 — Indefinite pipeline hangs caused by collect-then-yield
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamProcessor } from './StreamProcessor.js';
import type { GenerateContentResponse } from '@google/genai';
import type { Content, Part } from '@google/genai';

// Minimal mock of dependencies needed by StreamProcessor
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
    recordStreamingHistory: vi.fn(),
  };
}

function createMockHistoryService() {
  return {
    add: vi.fn(),
    getAll: () => [],
    waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
  };
}

function makeChunk(text: string): GenerateContentResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }],
        },
      },
    ],
  } as unknown as GenerateContentResponse;
}

function makeFinishChunk(
  text: string,
  finishReason: string,
): GenerateContentResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }],
        },
        finishReason,
      },
    ],
  } as unknown as GenerateContentResponse;
}

describe('StreamProcessor.processStreamResponse — yield-as-you-go (#1846)', () => {
  let processor: StreamProcessor;

  beforeEach(() => {
    // StreamProcessor only needs a few fields from its constructor deps.
    // We provide minimal stubs to avoid constructing the entire runtime.
    processor = Object.create(StreamProcessor.prototype);

    // Inject required private fields
    const ctx = createMockRuntimeContext();
    const compression = createMockCompressionHandler();
    const conversation = createMockConversationManager();
    const history = createMockHistoryService();

    Object.assign(processor, {
      runtimeContext: ctx,
      compressionHandler: compression,
      conversationManager: conversation,
      historyService: history,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        enabled: false,
      },
    });

    // Stub internal methods that processStreamResponse calls post-loop
    (processor as unknown as Record<string, unknown>)['_consolidateTextParts'] =
      (parts: Part[]) => parts;
    (processor as unknown as Record<string, unknown>)['_extractResponseText'] =
      () => '';
    (processor as unknown as Record<string, unknown>)[
      '_validateStreamCompletion'
    ] = vi.fn();
    (processor as unknown as Record<string, unknown>)[
      '_recordHistoryWithUsage'
    ] = vi.fn().mockResolvedValue(undefined);
  });

  it('yields each chunk before the source stream ends', async () => {
    // Track the order of events: source yields vs consumer receives
    const timeline: string[] = [];

    async function* slowSource(): AsyncGenerator<GenerateContentResponse> {
      timeline.push('source:yield:1');
      yield makeChunk('Hello');
      timeline.push('source:yield:2');
      yield makeChunk(' world');
      timeline.push('source:yield:3');
      yield makeFinishChunk('!', 'STOP');
      timeline.push('source:done');
    }

    const userInput: Content = {
      role: 'user',
      parts: [{ text: 'Hi' }],
    };

    const gen = processor.processStreamResponse(slowSource(), userInput);

    // Consume chunks one at a time and record when we receive each
    const result1 = await gen.next();
    timeline.push('consumer:received:1');

    const result2 = await gen.next();
    timeline.push('consumer:received:2');

    const result3 = await gen.next();
    timeline.push('consumer:received:3');

    // Drain the generator
    await gen.next();

    expect(result1.done).toBe(false);
    expect(result2.done).toBe(false);
    expect(result3.done).toBe(false);

    // THE CRITICAL ASSERTION: Consumer receives each chunk immediately
    // after the source yields it, NOT after all chunks are collected.
    //
    // In a correct yield-as-you-go implementation, the timeline looks like:
    //   source:yield:1, consumer:received:1, source:yield:2, consumer:received:2, ...
    //
    // In the broken collect-then-yield implementation, it would look like:
    //   source:yield:1, source:yield:2, source:yield:3, source:done,
    //   consumer:received:1, consumer:received:2, consumer:received:3
    const firstConsumerIdx = timeline.indexOf('consumer:received:1');
    const secondSourceIdx = timeline.indexOf('source:yield:2');

    expect(firstConsumerIdx).toBeLessThan(secondSourceIdx);
  });

  it('yields chunks immediately even when the source stream stalls', async () => {
    let resolveStall: (() => void) | undefined;
    const stallPromise = new Promise<void>((r) => {
      resolveStall = r;
    });

    async function* stallingSource(): AsyncGenerator<GenerateContentResponse> {
      yield makeChunk('first chunk');
      // Simulate an API stall — the stream just stops producing
      await stallPromise;
      yield makeFinishChunk('resumed', 'STOP');
    }

    const userInput: Content = {
      role: 'user',
      parts: [{ text: 'Hi' }],
    };

    const gen = processor.processStreamResponse(stallingSource(), userInput);

    // We should get the first chunk immediately, even though the stream stalls
    const result1 = await gen.next();
    expect(result1.done).toBe(false);

    const chunk = result1.value as GenerateContentResponse;
    const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
    expect(text).toBe('first chunk');

    // Unstall the stream so the test can complete
    resolveStall!();

    // Drain remaining
    const result2 = await gen.next();
    expect(result2.done).toBe(false);

    await gen.next(); // generator done
  });

  it('yields the correct number of chunks matching the source', async () => {
    async function* threeChunks(): AsyncGenerator<GenerateContentResponse> {
      yield makeChunk('a');
      yield makeChunk('b');
      yield makeFinishChunk('c', 'STOP');
    }

    const userInput: Content = {
      role: 'user',
      parts: [{ text: 'Hi' }],
    };

    const yielded: GenerateContentResponse[] = [];
    for await (const chunk of processor.processStreamResponse(
      threeChunks(),
      userInput,
    )) {
      yielded.push(chunk);
    }

    expect(yielded).toHaveLength(3);
  });
});
