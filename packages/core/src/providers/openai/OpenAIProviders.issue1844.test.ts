/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * OpenAI streaming and non-streaming providers must propagate terminal
 * stop/finish metadata into IContent.metadata so downstream telemetry and
 * turn handling do not hang.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { IContent } from '../../services/history/IContent.js';
import { ToolCallPipeline } from './ToolCallPipeline.js';

let handleNonStreamingResponse: typeof import('./OpenAINonStreamHandler.js').handleNonStreamingResponse;
let processStreamingResponse: typeof import('./OpenAIStreamProcessor.js').processStreamingResponse;

function createMockCompletion(finishReason: string, content: string) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion' as const,
    created: Date.now(),
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          refusal: null,
          content,
        },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
    },
  } as unknown as Awaited<
    ReturnType<
      (typeof import('openai').default)['chat']['completions']['create']
    >
  >;
}

async function collectResults(
  iterator: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const results: IContent[] = [];
  for await (const chunk of iterator) {
    results.push(chunk);
  }
  return results;
}

async function* createChunkStream(
  chunks: unknown[],
): AsyncGenerator<unknown, void, undefined> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('issue #1844 – OpenAI terminal metadata propagation', () => {
  beforeAll(async () => {
    const nonStreamModule = await import('./OpenAINonStreamHandler.js');
    handleNonStreamingResponse = nonStreamModule.handleNonStreamingResponse;

    const streamModule = await import('./OpenAIStreamProcessor.js');
    processStreamingResponse = streamModule.processStreamingResponse;
  });

  it('should include stopReason and finishReason in metadata when finish_reason is "stop"', async () => {
    const completion = createMockCompletion('stop', 'Hello world');

    const deps = {
      toolCallPipeline: {
        normalizeToolName: (name: string) => name,
      },
      textToolParser: { parse: () => ({ toolCalls: [], cleanedContent: '' }) },
      logger: { debug: vi.fn(), warn: vi.fn(), log: vi.fn() },
    };

    const results = await collectResults(
      handleNonStreamingResponse(
        completion,
        'gpt-4o',
        'openai',
        deps as unknown as Parameters<typeof handleNonStreamingResponse>[3],
      ),
    );

    const withMeta = results.find((result) => result.metadata);
    expect(withMeta).toBeDefined();
    // stopReason is normalized (stop → end_turn), finishReason preserves raw value
    expect(withMeta!.metadata!.stopReason).toBe('end_turn');
    expect(withMeta!.metadata!.finishReason).toBe('stop');
  });

  it('should include stopReason and finishReason in metadata when finish_reason is "tool_calls"', async () => {
    const completion = createMockCompletion('tool_calls', '');

    const deps = {
      toolCallPipeline: {
        normalizeToolName: (name: string) => name,
      },
      textToolParser: { parse: () => ({ toolCalls: [], cleanedContent: '' }) },
      logger: { debug: vi.fn(), warn: vi.fn(), log: vi.fn() },
    };

    const results = await collectResults(
      handleNonStreamingResponse(
        completion,
        'gpt-4o',
        'openai',
        deps as unknown as Parameters<typeof handleNonStreamingResponse>[3],
      ),
    );

    const withMeta = results.find((result) => result.metadata);
    expect(withMeta).toBeDefined();
    // stopReason is normalized (tool_calls → tool_use), finishReason preserves raw value
    expect(withMeta!.metadata!.stopReason).toBe('tool_use');
    expect(withMeta!.metadata!.finishReason).toBe('tool_calls');
  });

  it('should emit a terminal metadata chunk for streaming responses even when usage is absent', async () => {
    const chunks = [
      {
        id: 'chunk-1',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: { content: 'Hello' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chunk-2',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ];

    let continuationRequested = false;
    const iterator = processStreamingResponse(
      createChunkStream(chunks) as unknown as Parameters<
        typeof processStreamingResponse
      >[0],
      'gpt-4o',
      'openai',
      undefined,
      {} as Parameters<typeof processStreamingResponse>[4],
      [],
      {} as Parameters<typeof processStreamingResponse>[6],
      undefined,
      undefined,
      {
        toolCallPipeline: new ToolCallPipeline(),
        textToolParser: {
          parse: (text: string) => ({ toolCalls: [], cleanedContent: text }),
        },
        logger: {
          debug: vi.fn(),
          warn: vi.fn(),
          log: vi.fn(),
          error: vi.fn(),
        },
        getBaseURL: () => undefined,
      } as unknown as Parameters<typeof processStreamingResponse>[9],
      async function* () {
        continuationRequested = true;
        yield* [] as IContent[];
      } as Parameters<typeof processStreamingResponse>[10],
    );

    const results = await collectResults(iterator);
    const lastChunk = results[results.length - 1];

    expect(continuationRequested).toBe(false);
    expect(lastChunk.metadata?.stopReason).toBe('end_turn');
    expect(lastChunk.metadata?.finishReason).toBe('stop');
  });

  it('should not emit a duplicate terminal metadata chunk when reasoning content already carries the finish signal', async () => {
    const chunks = [
      {
        id: 'chunk-1',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {
              reasoning_content: 'First think through the request.',
            },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chunk-2',
        object: 'chat.completion.chunk',
        created: Date.now(),
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop',
          },
        ],
      },
    ];

    const results = await collectResults(
      processStreamingResponse(
        createChunkStream(chunks) as unknown as Parameters<
          typeof processStreamingResponse
        >[0],
        'gpt-4o',
        'openai',
        undefined,
        {} as Parameters<typeof processStreamingResponse>[4],
        [],
        {} as Parameters<typeof processStreamingResponse>[6],
        undefined,
        undefined,
        {
          toolCallPipeline: new ToolCallPipeline(),
          textToolParser: {
            parse: (text: string) => ({ toolCalls: [], cleanedContent: text }),
          },
          logger: {
            debug: vi.fn(),
            warn: vi.fn(),
            log: vi.fn(),
            error: vi.fn(),
          },
          getBaseURL: () => undefined,
        } as unknown as Parameters<typeof processStreamingResponse>[9],
        async function* () {
          yield* [] as IContent[];
        } as Parameters<typeof processStreamingResponse>[10],
      ),
    );

    expect(results).toHaveLength(1);
    expect(results[0].blocks).toHaveLength(1);
    expect(results[0].blocks[0]).toMatchObject({
      type: 'thinking',
      thought: 'First think through the request.',
    });
    // stopReason is normalized (stop → end_turn), finishReason preserves raw value
    expect(results[0].metadata?.stopReason).toBe('end_turn');
    expect(results[0].metadata?.finishReason).toBe('stop');
  });
});
