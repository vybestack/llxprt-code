/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Issue #207: parseResponsesStream must capture the response.id from the
 * `response.completed` SSE event onto the metadata chunk so the Responses
 * API provider can thread it as `previous_response_id` for stateful
 * conversations.
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { parseResponsesStream } from './parseResponsesStream.js';

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index < chunks.length) {
        const chunk = chunks[index++];
        controller.enqueue(encoder.encode(chunk));
      } else {
        controller.close();
      }
    },
  });
}

describe('parseResponsesStream captures response.id @issue:207', () => {
  it('places response.id on the metadata chunk alongside usage', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp_abc","object":"response","model":"gpt-4o","status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const usageMessage = messages.find((m) => m.metadata?.usage);
    expect(usageMessage).toBeDefined();
    expect(usageMessage?.metadata?.id).toBe('resp_abc');
    expect(usageMessage?.metadata?.usage).toStrictEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cachedTokens: 0,
    });
  });

  it('emits a minimal metadata chunk with response.id when usage is absent', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp_xyz","object":"response","model":"gpt-4o","status":"completed"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const idMessage = messages.find((m) => m.metadata?.id === 'resp_xyz');
    expect(idMessage).toBeDefined();
    expect(idMessage?.metadata?.usage).toBeUndefined();
  });

  it('emits no metadata chunk when response.completed lacks both id and usage', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hi"}\n\n',
      'data: {"type":"response.completed","response":{"object":"response","model":"gpt-4o","status":"completed"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const metadataMessage = messages.find((m) => m.metadata);
    expect(metadataMessage).toBeUndefined();
  });
});
