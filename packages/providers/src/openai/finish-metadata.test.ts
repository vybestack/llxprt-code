/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import OpenAI from 'openai';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ToolCallPipeline } from './ToolCallPipeline.js';
import { mapFinishReason } from './finishReasonMapping.js';
import type { NonStreamHandlerDeps } from './OpenAINonStreamHandler.js';
import { handleNonStreamingResponse } from './OpenAINonStreamHandler.js';
import { processStreamingResponse } from './OpenAIStreamProcessor.js';
import { parseResponsesStream } from './parseResponsesStream.js';

async function collect(stream: AsyncIterable<IContent>): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function dependencies(): NonStreamHandlerDeps & {
  getBaseURL: () => undefined;
} {
  return {
    toolCallPipeline: new ToolCallPipeline(),
    textToolParser: new GemmaToolCallParser(),
    logger: new DebugLogger('llxprt:test:finish-metadata'),
    getBaseURL: () => undefined,
  };
}

const reasons = [
  ['stop', 'stop'],
  ['length', 'max_tokens'],
  ['tool_calls', 'tool_calls'],
  ['function_call', 'tool_calls'],
  ['content_filter', 'safety'],
  ['refusal', 'refusal'],
  ['future_reason', 'other'],
  ['constructor', 'other'],
] as const;

async function completion(
  raw: string,
  content: string | null,
  withUsage: boolean,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const client = new OpenAI({
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
              message: { role: 'assistant', content, refusal: null },
              finish_reason: raw,
            },
          ],
          ...(withUsage
            ? {
                usage: {
                  prompt_tokens: 2,
                  completion_tokens: 3,
                  total_tokens: 5,
                },
              }
            : {}),
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  });
  return client.chat.completions.create({ model: 'test', messages: [] });
}

async function* stream(
  raw: string,
  withUsage: boolean,
  reasoning: boolean,
): AsyncGenerator<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const chunks = [
    {
      id: 'finish-test',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test',
      choices: [
        {
          index: 0,
          delta: reasoning
            ? { reasoning_content: 'Consider the request.' }
            : { content: 'Answer' },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'finish-test',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'test',
      choices: [{ index: 0, delta: {}, finish_reason: raw }],
      ...(withUsage
        ? { usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }
        : {}),
    },
  ];
  const body =
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') +
    'data: [DONE]\n\n';
  const client = new OpenAI({
    apiKey: 'test-only',
    fetch: async () =>
      new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  });
  yield* await client.chat.completions.create({
    model: 'test',
    messages: [],
    stream: true,
  });
}

describe('OpenAI terminal finish metadata', () => {
  it.each(reasons)(
    'maps non-streaming %s to %s on text and metadata-only responses',
    async (raw, expected) => {
      for (const content of ['Answer', null]) {
        for (const withUsage of [true, false]) {
          const chunks = await collect(
            handleNonStreamingResponse(
              await completion(raw, content, withUsage),
              'test',
              'openai',
              dependencies(),
            ),
          );
          expect(chunks[chunks.length - 1]?.metadata).toMatchObject({
            finishReason: expected,
            rawStopReason: raw,
          });
        }
      }
    },
  );

  it.each(reasons)(
    'maps streaming %s to %s with and without usage or reasoning',
    async (raw, expected) => {
      for (const withUsage of [true, false]) {
        for (const reasoning of [true, false]) {
          const chunks = await collect(
            processStreamingResponse(
              stream(raw, withUsage, reasoning),
              'test',
              'openai',
              undefined,
              { model: 'test', messages: [], stream: true },
              [],
              new OpenAI({ apiKey: 'test-only' }),
              undefined,
              undefined,
              dependencies(),
              async function* () {
                yield* [];
              },
            ),
          );
          expect(chunks[chunks.length - 1]?.metadata).toMatchObject({
            finishReason: expected,
            rawStopReason: raw,
          });
        }
      }
    },
  );

  it.each([
    ['completed', 'stop'],
    ['incomplete', 'max_tokens'],
  ] as const)(
    'maps Responses status %s to %s even without usage or id',
    async (raw, expected) => {
      const body = new TextEncoder().encode(
        `data: ${JSON.stringify({ type: `response.${raw}`, response: { status: raw } })}\n\n`,
      );
      const chunks = await collect(
        parseResponsesStream(
          new ReadableStream({
            start(controller) {
              controller.enqueue(body);
              controller.close();
            },
          }),
        ),
      );
      expect(chunks[chunks.length - 1]?.metadata).toMatchObject({
        finishReason: expected,
        rawStopReason: raw,
      });
    },
  );
});

describe('Responses status mapping', () => {
  it.each([
    ['completed', 'stop'],
    ['incomplete', 'max_tokens'],
    ['failed', 'error'],
  ] as const)('maps %s to %s', (raw, expected) => {
    expect(mapFinishReason(raw)).toStrictEqual({
      finishReason: expected,
      rawStopReason: raw,
    });
  });
  it('retains failure errors instead of emitting a successful terminal chunk', async () => {
    const body =
      'data: {"type":"response.failed","response":{"status":"failed","error":{"code":"server_error","message":"upstream failed"}}}\n\n';
    const stream = new Response(body).body;
    if (stream === null) throw new Error('Missing fixture stream');
    await expect(collect(parseResponsesStream(stream))).rejects.toThrow(
      'upstream failed',
    );
  });
});
