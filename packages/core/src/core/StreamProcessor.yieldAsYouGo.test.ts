/**
 * Behavioral tests for StreamProcessor.processStreamResponse yield-as-you-go
 * streaming. Verifies the critical invariant that chunks are yielded inline
 * during iteration rather than buffered and emitted after the stream ends.
 *
 * @issue #1846 — Indefinite pipeline hangs caused by collect-then-yield
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamProcessor } from './StreamProcessor.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import type { GenerateContentResponse } from '@google/genai';
import type { Content, Part } from '@google/genai';

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
    processor = Object.create(StreamProcessor.prototype);

    const ctx = createMockRuntimeContext();
    const compression = createMockCompressionHandler();
    const conversation = createMockConversationManager();
    const history = createMockHistoryService();

    Object.assign(processor, {
      runtimeContext: ctx,
      compressionHandler: compression,
      conversationManager: conversation,
      historyService: history,
      logger: new DebugLogger('test'),
    });

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

    const result1 = await gen.next();
    timeline.push('consumer:received:1');

    const result2 = await gen.next();
    timeline.push('consumer:received:2');

    const result3 = await gen.next();
    timeline.push('consumer:received:3');

    await gen.next();

    expect(result1.done).toBe(false);
    expect(result2.done).toBe(false);
    expect(result3.done).toBe(false);

    const firstConsumerIdx = timeline.indexOf('consumer:received:1');
    const secondSourceIdx = timeline.indexOf('source:yield:2');

    expect(firstConsumerIdx).toBeLessThan(secondSourceIdx);
  });

  it('yields chunks immediately even when the source stream stalls', async () => {
    let resolveStall: (() => void) | undefined;
    const stallPromise = new Promise<void>((resolve) => {
      resolveStall = resolve;
    });

    async function* stallingSource(): AsyncGenerator<GenerateContentResponse> {
      yield makeChunk('first chunk');
      await stallPromise;
      yield makeFinishChunk('resumed', 'STOP');
    }

    const userInput: Content = {
      role: 'user',
      parts: [{ text: 'Hi' }],
    };

    const gen = processor.processStreamResponse(stallingSource(), userInput);

    const result1 = await gen.next();
    expect(result1.done).toBe(false);

    const chunk = result1.value as GenerateContentResponse;
    const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text;
    expect(text).toBe('first chunk');

    resolveStall?.();

    const result2 = await gen.next();
    expect(result2.done).toBe(false);

    await gen.next();
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
