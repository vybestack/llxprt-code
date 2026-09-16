/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { handleNonStreamingResponse } from './vercelNonStreamingHandler.js';

describe('Vercel non-streaming finish metadata', () => {
  it.each([
    ['stop', 'stop', 'stop'],
    ['length', 'max_tokens', 'length'],
    ['tool_calls', 'tool_calls', 'tool-calls'],
    ['content_filter', 'safety', 'content-filter'],
  ] as const)(
    'normalizes %s on the terminal response',
    async (wireReason, expected, raw) => {
      const provider = createOpenAI({
        apiKey: 'test-only',
        fetch: async () =>
          new Response(
            JSON.stringify({
              id: 'finish-test',
              object: 'chat.completion',
              created: 0,
              model: 'test',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'Answer' },
                  finish_reason: wireReason,
                },
              ],
              usage: {
                prompt_tokens: 2,
                completion_tokens: 3,
                total_tokens: 5,
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      });
      const result = await generateText({
        model: provider.chat('test'),
        prompt: 'Hello',
      });
      const chunks: IContent[] = [];

      for await (const chunk of handleNonStreamingResponse(
        result,
        {
          enabled: false,
          includeInResponse: false,
          includeInContext: false,
          stripFromContext: 'none',
          format: 'native',
          fieldName: 'reasoning_content',
        },
        new DebugLogger('llxprt:test:vercel-finish'),
      ))
        chunks.push(chunk);

      expect(chunks[chunks.length - 1]?.metadata).toMatchObject({
        finishReason: expected,
        rawStopReason: raw,
      });
    },
  );
});
