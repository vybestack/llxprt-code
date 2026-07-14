/**
 * Behavioral tests for StreamProcessor.processStreamResponse yield-as-you-go
 * streaming. Verifies the critical invariant that chunks are yielded inline
 * during iteration rather than buffered and emitted after the stream ends.
 *
 * @issue #1846 — Indefinite pipeline hangs caused by collect-then-yield
 * @plan PLAN-20260707-AGENTNEUTRAL.P11 — updated to use neutral ModelStreamChunk
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamProcessor } from './StreamProcessor.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

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
    recordHistory: vi.fn(),
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
      logger: new DebugLogger('test'),
      eagerlyRecordedToolResponseCallIds: new Set<string>(),
    });

    // Stub internal methods that processStreamResponse calls post-loop
    (processor as unknown as Record<string, unknown>)[
      '_finalizeStreamProcessing'
    ] = vi.fn().mockResolvedValue(undefined);
  });

  it('yields each chunk before the source stream ends', async () => {
    // Track the order of events: source yields vs consumer receives
    const timeline: string[] = [];

    async function* slowSource(): AsyncGenerator<ModelStreamChunk> {
      timeline.push('source:yield:1');
      yield makeChunk('Hello');
      timeline.push('source:yield:2');
      yield makeChunk(' world');
      timeline.push('source:yield:3');
      yield makeFinishChunk('!', 'STOP');
      timeline.push('source:done');
    }

    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hi' }],
    } as IContent;

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
    const stallPromise = new Promise<void>((resolve) => {
      resolveStall = resolve;
    });

    async function* stallingSource(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('first chunk');
      // Simulate an API stall — the stream just stops producing
      await stallPromise;
      yield makeFinishChunk('resumed', 'STOP');
    }

    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hi' }],
    } as IContent;

    const gen = processor.processStreamResponse(stallingSource(), userInput);

    // We should get the first chunk immediately, even though the stream stalls
    const result1 = await gen.next();
    expect(result1.done).toBe(false);

    const chunk = result1.value;
    const firstBlock = chunk.content.blocks[0];
    expect(firstBlock?.type).toBe('text');
    expect(firstBlock?.type === 'text' ? firstBlock.text : undefined).toBe(
      'first chunk',
    );

    // Unstall the stream so the test can complete
    resolveStall?.();

    // Drain remaining
    const result2 = await gen.next();
    expect(result2.done).toBe(false);

    await gen.next(); // generator done
  });

  it('yields an empty-block chunk after hook restrictions filter every tool call', async () => {
    const neutralChunk = toModelStreamChunk({
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'blocked-call',
          name: 'run_shell_command',
          parameters: { command: 'echo blocked' },
        },
      ],
    } as IContent);

    neutralChunk.hookRestrictions = {
      allowedToolNames: ['not-a-allowed-tool'],
    };

    async function* filteredOnlyStream(): AsyncGenerator<ModelStreamChunk> {
      yield neutralChunk;
    }

    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hi' }],
    } as IContent;

    const yielded: ModelStreamChunk[] = [];
    // With _finalizeStreamProcessing stubbed, the stream completes without
    // throwing (the validation is skipped).
    for await (const chunk of processor.processStreamResponse(
      filteredOnlyStream(),
      userInput,
    )) {
      yielded.push(chunk);
    }

    // The blocked tool call is filtered out by hook restrictions,
    // so the yielded chunk has empty blocks.
    expect(yielded).toHaveLength(1);
    expect(yielded[0].content.blocks).toHaveLength(0);
  });

  it('yields the correct number of chunks matching the source', async () => {
    async function* threeChunks(): AsyncGenerator<ModelStreamChunk> {
      yield makeChunk('a');
      yield makeChunk('b');
      yield makeFinishChunk('c', 'STOP');
    }

    const userInput: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hi' }],
    } as IContent;

    const yielded: ModelStreamChunk[] = [];
    for await (const chunk of processor.processStreamResponse(
      threeChunks(),
      userInput,
    )) {
      yielded.push(chunk);
    }

    expect(yielded).toHaveLength(3);
  });
});
