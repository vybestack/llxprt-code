/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for executor-stream-processor parameter normalization.
 *
 * Verifies that callModelAndConsumeStream normalizes ToolCallBlock.parameters
 * (typed `unknown`) to a well-formed Record<string, unknown> using a record
 * guard — returning {} for null, arrays, and primitives so downstream tool
 * dispatch always receives a valid argument object.
 *
 * Tests through the REAL callModelAndConsumeStream → processStreamChunk path
 * with a fake ChatSession that yields ModelStreamChunk values.
 */

import { describe, it, expect } from 'vitest';
import type { StreamEvent } from '../core/chatSession.js';
import { StreamEventType } from '../core/chatSession.js';
import { callModelAndConsumeStream } from './executor-stream-processor.js';
import { createMockResponseChunk } from './executor-test-helpers.js';
import { makeFakeConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ToolCallBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/** Minimal fake ChatSession that yields pre-built chunks as stream events. */
function makeFakeChat(chunks: ModelStreamChunk[]): {
  chat: {
    sendMessageStream: (
      _params: unknown,
      _promptId: string,
    ) => Promise<AsyncGenerator<StreamEvent>>;
  };
} {
  return {
    chat: {
      sendMessageStream: async () => {
        const events: StreamEvent[] = chunks.map((chunk) => ({
          type: StreamEventType.CHUNK,
          value: chunk,
        }));
        return (async function* (): AsyncGenerator<StreamEvent> {
          for (const e of events) {
            yield e;
          }
        })();
      },
    },
  };
}

/** Creates a chunk whose first tool_call block has the given raw parameters. */
function chunkWithParameters(
  parameters: unknown,
  name = 'test_tool',
  id = 'call-1',
): ModelStreamChunk {
  const chunk = createMockResponseChunk([], [{ id, name, args: {} }]);
  const block = chunk.content.blocks[0] as ToolCallBlock;
  block.parameters = parameters;
  return chunk;
}

describe('executor-stream-processor — normalizeToolCallParameters via callModelAndConsumeStream', () => {
  const config = makeFakeConfig();
  const noopEmit = () => {};

  it('normalizes null parameters to {} before returning functionCalls', async () => {
    const chunk = chunkWithParameters(null);
    const { chat } = makeFakeChat([chunk]);

    const result = await callModelAndConsumeStream(
      chat as never,
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] } as IContent,
      undefined,
      new AbortController().signal,
      'prompt-1',
      config,
      noopEmit,
    );

    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0].args).toStrictEqual({});
  });

  it('normalizes array parameters to {} before returning functionCalls', async () => {
    const chunk = chunkWithParameters([1, 2, 3]);
    const { chat } = makeFakeChat([chunk]);

    const result = await callModelAndConsumeStream(
      chat as never,
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] } as IContent,
      undefined,
      new AbortController().signal,
      'prompt-1',
      config,
      noopEmit,
    );

    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0].args).toStrictEqual({});
  });

  it('normalizes string primitive parameters to {} before returning functionCalls', async () => {
    const chunk = chunkWithParameters('not-an-object');
    const { chat } = makeFakeChat([chunk]);

    const result = await callModelAndConsumeStream(
      chat as never,
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] } as IContent,
      undefined,
      new AbortController().signal,
      'prompt-1',
      config,
      noopEmit,
    );

    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0].args).toStrictEqual({});
  });

  it('normalizes number primitive parameters to {} before returning functionCalls', async () => {
    const chunk = chunkWithParameters(42);
    const { chat } = makeFakeChat([chunk]);

    const result = await callModelAndConsumeStream(
      chat as never,
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] } as IContent,
      undefined,
      new AbortController().signal,
      'prompt-1',
      config,
      noopEmit,
    );

    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0].args).toStrictEqual({});
  });

  it('normalizes undefined parameters to {} before returning functionCalls', async () => {
    const chunk = chunkWithParameters(undefined);
    const { chat } = makeFakeChat([chunk]);

    const result = await callModelAndConsumeStream(
      chat as never,
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] } as IContent,
      undefined,
      new AbortController().signal,
      'prompt-1',
      config,
      noopEmit,
    );

    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0].args).toStrictEqual({});
  });

  it('preserves valid record parameters through callModelAndConsumeStream', async () => {
    const validParams = { path: '/tmp', recursive: true };
    const chunk = chunkWithParameters(validParams);
    const { chat } = makeFakeChat([chunk]);

    const result = await callModelAndConsumeStream(
      chat as never,
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] } as IContent,
      undefined,
      new AbortController().signal,
      'prompt-1',
      config,
      noopEmit,
    );

    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls[0].args).toStrictEqual(validParams);
  });
});
