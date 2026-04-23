/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * OpenAI Responses API stream must propagate terminal status (stopReason)
 * so downstream telemetry and turn handling work.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { IContent } from '../../services/history/IContent.js';

let parseResponsesStream: typeof import('./parseResponsesStream.js').parseResponsesStream;

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

describe('issue #1844 – parseResponsesStream terminal metadata', () => {
  beforeAll(async () => {
    const mod = await import('./parseResponsesStream.js');
    parseResponsesStream = mod.parseResponsesStream;
  });

  it('should emit stopReason on response.completed', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp-123","object":"response","model":"gpt-4o","status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    // Find the usage/terminal message
    const terminalMessage = messages.find(
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: boolean OR for truthy check (usage OR stopReason present)
      (m) => m.metadata?.usage || m.metadata?.stopReason,
    );
    expect(terminalMessage).toBeDefined();

    // Should have usage
    expect(terminalMessage!.metadata!.usage).toStrictEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
      cachedTokens: 0,
    });

    // stopReason is normalized (completed → end_turn), finishReason preserves raw value
    expect(terminalMessage!.metadata!.stopReason).toBe('end_turn');
    expect(terminalMessage!.metadata!.finishReason).toBe('completed');
  });

  it('should emit stopReason on response.done', async () => {
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Test"}\n\n',
      'data: {"type":"response.done","response":{"id":"resp-456","object":"response","model":"codex-mini","status":"completed","usage":{"input_tokens":5,"output_tokens":3,"total_tokens":8}}}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = createSSEStream(chunks);
    const messages: IContent[] = [];

    for await (const message of parseResponsesStream(stream)) {
      messages.push(message);
    }

    const terminalMessage = messages.find(
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: boolean OR for truthy check (usage OR stopReason present)
      (m) => m.metadata?.usage || m.metadata?.stopReason,
    );
    expect(terminalMessage).toBeDefined();
    // stopReason is normalized (completed → end_turn), finishReason preserves raw value
    expect(terminalMessage!.metadata!.stopReason).toBe('end_turn');
    expect(terminalMessage!.metadata!.finishReason).toBe('completed');
  });
});
