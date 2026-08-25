/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import Anthropic from '@anthropic-ai/sdk';
import { createAnthropicApiCall } from './AnthropicApiExecution.js';

async function bodyText(body: BodyInit | null | undefined): Promise<string> {
  return body === null || body === undefined ? '' : new Response(body).text();
}

describe('Anthropic bounded HTTP transport', () => {
  it('sends exact finite JSON bytes as a stream with an exact content length', async () => {
    let wireBody = '';
    let streamed = false;
    const contentLength: { value: string | null } = { value: null };
    const fetchTransport: typeof fetch = async (_input, init) => {
      streamed = init?.body instanceof ReadableStream;
      contentLength.value = new Headers(init?.headers).get('content-length');
      wireBody = await bodyText(init?.body);
      return Response.json({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      });
    };
    const client = new Anthropic({ apiKey: 'test-key', fetch: fetchTransport });
    const requestBody: Record<string, unknown> = {
      model: 'claude-test',
      max_tokens: 32,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'QUJD',
              },
            },
          ],
        },
      ],
      stream: false,
    };

    const result = await createAnthropicApiCall(client, requestBody, {})();

    const expected = JSON.stringify(requestBody);
    expect(result.data).toMatchObject({ id: 'msg_test' });
    expect(streamed).toBe(true);
    expect(wireBody).toBe(expected);
    expect(contentLength.value).toBe(
      String(new TextEncoder().encode(expected).byteLength),
    );
  });
});
