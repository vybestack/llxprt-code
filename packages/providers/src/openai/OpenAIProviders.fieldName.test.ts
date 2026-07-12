/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for issue #2505: the classic openai provider must honor a
 * configurable reasoning field name (reasoning.fieldName) with auto-fallback
 * to delta.reasoning for Ollama, and propagate the actual captured field as
 * the terminal ThinkingBlock sourceField provenance.
 *
 * These tests exercise processStreamingResponse end-to-end (the wiring that
 * threads StreamProcessorDeps.reasoningFieldName into parseStreamingReasoningDelta
 * and into the terminal combined thinking block), not just the parser unit.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ToolCallPipeline } from './ToolCallPipeline.js';
import { processStreamingResponse } from './OpenAIStreamProcessor.js';

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

function makeChunk(
  delta: Record<string, unknown>,
  finishReason: string | null,
) {
  return {
    id: 'chunk-test',
    object: 'chat.completion.chunk',
    created: 1000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

type StreamDeps = Parameters<typeof processStreamingResponse>[9];

function makeDeps(reasoningFieldName: string | undefined): StreamDeps {
  return {
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
    reasoningFieldName,
  } as unknown as StreamDeps;
}

async function runStreaming(
  chunks: unknown[],
  reasoningFieldName: string | undefined,
): Promise<IContent[]> {
  return collectResults(
    processStreamingResponse(
      createChunkStream(chunks) as unknown as Parameters<
        typeof processStreamingResponse
      >[0],
      'test-model',
      'openai',
      undefined,
      {} as Parameters<typeof processStreamingResponse>[4],
      [],
      {} as Parameters<typeof processStreamingResponse>[6],
      undefined,
      undefined,
      makeDeps(reasoningFieldName),
      async function* () {
        yield* [] as IContent[];
      } as Parameters<typeof processStreamingResponse>[10],
    ),
  );
}

function findThinkingBlock(
  results: IContent[],
):
  | { type: 'thinking'; thought: string; sourceField: string | undefined }
  | undefined {
  for (const content of results) {
    for (const block of content.blocks) {
      if (block.type === 'thinking') {
        return {
          type: 'thinking',
          thought: block.thought,
          sourceField: block.sourceField,
        };
      }
    }
  }
  return undefined;
}

describe('issue #2505 – classic openai provider reasoning.fieldName streaming', () => {
  it('captures delta.reasoning when fieldName is explicitly "reasoning" (Ollama)', async () => {
    const chunks = [
      makeChunk({ reasoning: 'ollama thinking trace' }, null),
      makeChunk({}, 'stop'),
    ];

    const results = await runStreaming(chunks, 'reasoning');

    const thinking = findThinkingBlock(results);
    expect(thinking).toBeDefined();
    expect(thinking).toMatchObject({
      type: 'thinking',
      thought: 'ollama thinking trace',
      sourceField: 'reasoning',
    });
  });

  it('auto-falls-back to delta.reasoning when fieldName is unset (Ollama out-of-the-box)', async () => {
    const chunks = [
      makeChunk({ reasoning: 'auto-fallback ollama reasoning' }, null),
      makeChunk({}, 'stop'),
    ];

    const results = await runStreaming(chunks, undefined);

    expect(findThinkingBlock(results)).toMatchObject({
      type: 'thinking',
      thought: 'auto-fallback ollama reasoning',
      sourceField: 'reasoning',
    });
  });

  it('captures reasoning_content when fieldName is unset (standard providers unaffected)', async () => {
    const chunks = [
      makeChunk({ reasoning_content: 'standard reasoning' }, null),
      makeChunk({}, 'stop'),
    ];

    const results = await runStreaming(chunks, undefined);

    expect(findThinkingBlock(results)).toMatchObject({
      type: 'thinking',
      thought: 'standard reasoning',
      sourceField: 'reasoning_content',
    });
  });

  it('prefers reasoning_content over reasoning when both present and unset', async () => {
    const chunks = [
      makeChunk({ reasoning_content: 'standard', reasoning: 'fallback' }, null),
      makeChunk({}, 'stop'),
    ];

    const results = await runStreaming(chunks, undefined);

    expect(findThinkingBlock(results)).toMatchObject({
      thought: 'standard',
      sourceField: 'reasoning_content',
    });
  });

  it('ignores reasoning_content when fieldName is explicitly "reasoning"', async () => {
    const chunks = [
      makeChunk({ reasoning_content: 'should be ignored' }, null),
      makeChunk({}, 'stop'),
    ];

    const results = await runStreaming(chunks, 'reasoning');

    expect(findThinkingBlock(results)).toBeUndefined();
  });

  it('accumulates multi-chunk Ollama reasoning into one terminal thinking block', async () => {
    const chunks = [
      makeChunk({ reasoning: 'part one ' }, null),
      makeChunk({ reasoning: 'part two' }, null),
      makeChunk({}, 'stop'),
    ];

    const results = await runStreaming(chunks, undefined);

    expect(findThinkingBlock(results)).toMatchObject({
      thought: 'part one part two',
      sourceField: 'reasoning',
    });
  });
});
