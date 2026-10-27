/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type OpenAI from 'openai';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import { processStreamingResponse } from './OpenAIStreamProcessor.js';
import { ToolCallPipeline } from './ToolCallPipeline.js';
import {
  pieces,
  expected,
  runDiskArrival,
} from '../__tests__/tool-arrival-fixture.js';

function chunks(
  gate: (index: number) => Promise<void>,
): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  async function* source(): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
    for (let index = 0; index < pieces.length; index++) {
      yield {
        id: 'chat',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test',
        choices: [
          {
            index: 0,
            finish_reason: null,
            logprobs: null,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  ...(index === 0
                    ? {
                        id: 'call_frozen',
                        type: 'function',
                      }
                    : {}),
                  function: {
                    ...(index === 0 ? { name: 'lookup' } : {}),
                    arguments: pieces[index],
                  },
                },
              ],
            },
          },
        ],
      };
      await gate(index);
    }
    yield {
      id: 'chat',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'test',
      choices: [
        { index: 0, delta: {}, finish_reason: 'tool_calls', logprobs: null },
      ],
    };
  }
  return source();
}

describe('OpenAI Chat tool argument disk arrival', () => {
  for (const format of ['openai', 'mistral', 'kimi']) {
    const factory = (gate: (index: number) => Promise<void>) =>
      processStreamingResponse(
        chunks(gate),
        'test',
        format,
        undefined,
        undefined,
        {
          toolCallPipeline: new ToolCallPipeline(),
          textToolParser: new GemmaToolCallParser(),
          logger: new DebugLogger('test:chat-arrival'),
          getBaseURL: () => undefined,
        },
        async function* () {},
      );
    it(`persists argument pieces before completion and preserves frozen ${format} parity`, async () => {
      expect(await runDiskArrival(factory, false)).toStrictEqual([
        { ...expected, id: 'hist_tool_frozen' },
      ]);
    });
    it(`rejects the retaining ${format} control`, async () => {
      await expect(runDiskArrival(factory, true)).rejects.toThrow(
        'Argument disk-progress gate failed',
      );
    });
  }
});
