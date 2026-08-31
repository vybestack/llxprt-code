/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import OpenAI from 'openai';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import { ToolCallPipeline } from './ToolCallPipeline.js';
import { processStreamingResponse } from './OpenAIStreamProcessor.js';
import { createStreamingState } from './OpenAIStreamProcessorState.js';
import {
  MAX_PROVIDER_BUFFERED_TEXT_BYTES,
  ProviderStreamProtocolError,
} from '../streamLimits.js';

function createChunk(
  index: number,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    id: `chunk-${index}`,
    object: 'chat.completion.chunk',
    created: index,
    model: 'test-model',
    choices: [],
  };
}

async function* createChunkStream(
  count: number,
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  for (let index = 0; index < count; index++) {
    yield createChunk(index);
  }
}

function createTextChunk(
  index: number,
  text: string,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    ...createChunk(index),
    choices: [
      {
        index: 0,
        delta: { content: text },
        finish_reason: null,
        logprobs: null,
      },
    ],
  };
}

async function* streamChunks(
  chunks: readonly OpenAI.Chat.Completions.ChatCompletionChunk[],
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  yield* chunks;
}

async function collect(
  stream: AsyncIterable<IContent>,
): Promise<readonly IContent[]> {
  const content: IContent[] = [];
  for await (const item of stream) {
    content.push(item);
  }
  return content;
}

function retainTotalChunksReceived(
  currentCount: number | undefined,
  metadata: unknown,
): number | undefined {
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    'totalChunksReceived' in metadata &&
    typeof metadata.totalChunksReceived === 'number'
  ) {
    return metadata.totalChunksReceived;
  }
  return currentCount;
}

async function runQwenStream(
  chunks: readonly OpenAI.Chat.Completions.ChatCompletionChunk[],
): Promise<readonly IContent[]> {
  const logger = new DebugLogger('llxprt:test:qwen-buffer-limit');
  const deps = {
    toolCallPipeline: new ToolCallPipeline(),
    textToolParser: new GemmaToolCallParser(),
    logger,
    getBaseURL: () => undefined,
  };
  return collect(
    processStreamingResponse(
      streamChunks(chunks),
      'qwen-test',
      'qwen',
      undefined,
      { model: 'qwen-test', messages: [], stream: true },
      [],
      new OpenAI({ apiKey: 'test-api-key' }),
      undefined,
      undefined,
      deps,
      async function* () {
        yield* [];
      },
    ),
  );
}

describe('OpenAI streaming diagnostic retention', () => {
  it('reports every received chunk without retaining a chunk array', async () => {
    const chunkCount = 7;
    let reportedChunkCount: number | undefined;
    const logger = new DebugLogger('llxprt:test:openai-stream-retention');
    logger.warn = (_message, metadata) => {
      reportedChunkCount = retainTotalChunksReceived(
        reportedChunkCount,
        metadata,
      );
    };
    const deps = {
      toolCallPipeline: new ToolCallPipeline(),
      textToolParser: new GemmaToolCallParser(),
      logger,
      getBaseURL: () => undefined,
    };
    const client = new OpenAI({ apiKey: 'test-api-key' });

    await collect(
      processStreamingResponse(
        createChunkStream(chunkCount),
        'test-model',
        'openai',
        undefined,
        { model: 'test-model', messages: [], stream: true },
        [],
        client,
        undefined,
        undefined,
        deps,
        async function* () {
          yield* [];
        },
      ),
    );

    expect(reportedChunkCount).toBe(chunkCount);
    expect(createStreamingState()).not.toHaveProperty('allChunks');
  });

  it('rejects an unterminated Kimi tool section at the buffered-text byte limit', async () => {
    const fragment = 'x'.repeat(1024 * 1024);
    const chunks = [
      createTextChunk(0, '<|tool_calls_section_begin|>'),
      ...Array.from(
        {
          length:
            Math.floor(MAX_PROVIDER_BUFFERED_TEXT_BYTES / fragment.length) + 1,
        },
        (_, index) => createTextChunk(index + 1, fragment),
      ),
    ];

    const result = runQwenStream(chunks);

    await expect(result).rejects.toBeInstanceOf(ProviderStreamProtocolError);
    await expect(result).rejects.toThrow(
      `buffered text exceeded ${MAX_PROVIDER_BUFFERED_TEXT_BYTES}-byte limit`,
    );
  });

  it('preserves large legitimate Qwen text byte-for-byte', async () => {
    const text = 'ø'.repeat(512 * 1024);

    const content = await runQwenStream([createTextChunk(0, text)]);
    const emittedText = content
      .flatMap((item) => item.blocks)
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    expect(emittedText).toBe(text);
  });
});
