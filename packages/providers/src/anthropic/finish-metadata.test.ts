/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import Anthropic from '@anthropic-ai/sdk';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { processAnthropicStream } from './AnthropicStreamProcessor.js';
import { parseAnthropicResponse } from './AnthropicResponseParser.js';

async function response(raw: string): Promise<Anthropic.Message> {
  const client = new Anthropic({
    apiKey: 'test-only',
    fetch: async () =>
      new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'test',
          content: [{ type: 'text', text: 'Answer' }],
          stop_reason: raw,
          stop_sequence: null,
          usage: { input_tokens: 2, output_tokens: 3 },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  });
  return client.messages.create({
    model: 'test',
    max_tokens: 10,
    messages: [],
  });
}

const reasons = [
  ['end_turn', 'stop'],
  ['max_tokens', 'max_tokens'],
  ['tool_use', 'tool_calls'],
  ['stop_sequence', 'stop'],
  ['refusal', 'refusal'],
  ['future_reason', 'other'],
  ['constructor', 'other'],
] as const;

describe('Anthropic terminal finish metadata', () => {
  it.each(reasons)('maps %s to %s', async (raw, expected) => {
    const chunk = parseAnthropicResponse(await response(raw), {
      isOAuth: false,
      tools: undefined,
      unprefixToolName: (name) => name,
      findToolSchema: () => undefined,
      cacheLogger: { debug: () => undefined },
      includeThinkingInResponse: true,
    });
    expect(chunk.metadata).toMatchObject({
      finishReason: expected,
      rawStopReason: raw,
      usage: { totalTokens: 5 },
    });
  });
});

describe('Anthropic streaming finish metadata', () => {
  it.each(reasons)(
    'maps %s to %s with and without usage',
    async (raw, expected) => {
      for (const withUsage of [true, false]) {
        const events = [
          {
            type: 'message_delta',
            delta: { stop_reason: raw, stop_sequence: null },
            ...(withUsage
              ? { usage: { input_tokens: 2, output_tokens: 3 } }
              : {}),
          },
          { type: 'message_stop' },
        ];
        const body = events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join('');
        const client = new Anthropic({
          apiKey: 'test-only',
          fetch: async () =>
            new Response(body, {
              headers: { 'content-type': 'text/event-stream' },
            }),
        });
        const responseStream = await client.messages.create({
          model: 'test',
          max_tokens: 10,
          messages: [],
          stream: true,
        });
        const chunks: IContent[] = [];
        for await (const chunk of processAnthropicStream(responseStream, {
          isOAuth: false,
          tools: undefined,
          unprefixToolName: (name) => name,
          findToolSchema: () => undefined,
          cacheLogger: { debug: () => undefined },
          logger: { debug: () => undefined },
          rateLimitLogger: { debug: () => undefined },
          includeThinkingInResponse: true,
        }))
          chunks.push(chunk);
        expect(chunks[chunks.length - 1]?.metadata).toMatchObject({
          finishReason: expected,
          rawStopReason: raw,
        });
      }
    },
  );
});
