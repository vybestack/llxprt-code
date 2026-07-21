/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the OpenAI Responses SSE parser's stream-liveness
 * callback (issue #2607). A successfully parsed lifecycle SSE event such as
 * response.created or response.in_progress evidences transport/provider
 * liveness even though it yields no semantic IContent, and must be reported
 * via the onStreamLiveness callback so the first-response watchdog can be
 * disarmed.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StreamLivenessEvent } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
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

describe('parseResponsesStream - stream liveness (issue #2607)', () => {
  it('reports liveness for response.created with sseObserved true and yields no IContent', async () => {
    const livenessEvents: StreamLivenessEvent[] = [];
    const chunks = [
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const messages: IContent[] = [];
    for await (const message of parseResponsesStream(createSSEStream(chunks), {
      onStreamLiveness: (event) => livenessEvents.push(event),
    })) {
      messages.push(message);
    }

    expect(livenessEvents).toContainEqual({
      sourceEvent: 'response.created',
      sseObserved: true,
    });
    expect(messages).toStrictEqual([]);
  });

  it('reports liveness for response.in_progress', async () => {
    const livenessEvents: StreamLivenessEvent[] = [];
    const chunks = [
      'data: {"type":"response.in_progress","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: [DONE]\n\n',
    ];

    for await (const _message of parseResponsesStream(createSSEStream(chunks), {
      onStreamLiveness: (event) => livenessEvents.push(event),
    })) {
      void _message;
    }

    expect(livenessEvents).toContainEqual({
      sourceEvent: 'response.in_progress',
      sseObserved: true,
    });
  });

  it('every parsed lifecycle event emits liveness, including duplicates of the same event type', async () => {
    const livenessEvents: StreamLivenessEvent[] = [];
    const chunks = [
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: {"type":"response.in_progress","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: [DONE]\n\n',
    ];

    for await (const _message of parseResponsesStream(createSSEStream(chunks), {
      onStreamLiveness: (event) => livenessEvents.push(event),
    })) {
      void _message;
    }

    const createdEvents = livenessEvents.filter(
      (e) => e.sourceEvent === 'response.created',
    );
    const inProgressEvents = livenessEvents.filter(
      (e) => e.sourceEvent === 'response.in_progress',
    );
    expect(createdEvents).toHaveLength(2);
    expect(inProgressEvents).toHaveLength(1);
  });

  it('semantic output is unchanged when a liveness callback is provided for a mixed lifecycle + content stream', async () => {
    const livenessEvents: StreamLivenessEvent[] = [];
    const chunks = [
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: [DONE]\n\n',
    ];

    const messagesWith: IContent[] = [];
    for await (const message of parseResponsesStream(createSSEStream(chunks), {
      onStreamLiveness: (event) => livenessEvents.push(event),
    })) {
      messagesWith.push(message);
    }

    const messagesWithout: IContent[] = [];
    for await (const message of parseResponsesStream(createSSEStream(chunks))) {
      messagesWithout.push(message);
    }

    expect(messagesWith).toStrictEqual(messagesWithout);
    expect(messagesWith).toStrictEqual([
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello' }],
      },
    ]);
    expect(livenessEvents).toContainEqual({
      sourceEvent: 'response.created',
      sseObserved: true,
    });
  });

  it('malformed JSON does not count as liveness', async () => {
    const livenessEvents: StreamLivenessEvent[] = [];
    const chunks = ['data: {not valid json\n\n', 'data: [DONE]\n\n'];

    for await (const _message of parseResponsesStream(createSSEStream(chunks), {
      onStreamLiveness: (event) => livenessEvents.push(event),
    })) {
      void _message;
    }

    expect(livenessEvents).toStrictEqual([]);
  });

  it('[DONE] does not count as liveness', async () => {
    const livenessEvents: StreamLivenessEvent[] = [];
    const chunks = ['data: [DONE]\n\n'];

    for await (const _message of parseResponsesStream(createSSEStream(chunks), {
      onStreamLiveness: (event) => livenessEvents.push(event),
    })) {
      void _message;
    }

    expect(livenessEvents).toStrictEqual([]);
  });

  it('a throwing liveness listener does not break parsing', async () => {
    const chunks = [
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: [DONE]\n\n',
    ];

    const messages: IContent[] = [];
    for await (const message of parseResponsesStream(createSSEStream(chunks), {
      onStreamLiveness: () => {
        throw new Error('listener blew up');
      },
    })) {
      messages.push(message);
    }

    expect(messages).toStrictEqual([
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello' }],
      },
    ]);
  });

  it('reports liveness for content-bearing events too (every parsed event)', async () => {
    const livenessEvents: StreamLivenessEvent[] = [];
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
      'data: [DONE]\n\n',
    ];

    for await (const _message of parseResponsesStream(createSSEStream(chunks), {
      onStreamLiveness: (event) => livenessEvents.push(event),
    })) {
      void _message;
    }

    expect(livenessEvents).toContainEqual({
      sourceEvent: 'response.output_text.delta',
      sseObserved: true,
    });
  });

  it('does not report liveness when no callback is supplied (no crash)', async () => {
    const chunks = [
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: [DONE]\n\n',
    ];

    const messages: IContent[] = [];
    for await (const message of parseResponsesStream(createSSEStream(chunks))) {
      messages.push(message);
    }

    expect(messages).toStrictEqual([]);
  });

  it('reports liveness for each response.created event in the stream', async () => {
    const livenessEvents: StreamLivenessEvent[] = [];
    const listener = vi.fn((event: StreamLivenessEvent) =>
      livenessEvents.push(event),
    );
    const chunks = [
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: {"type":"response.created","response":{"id":"r1","object":"response","model":"gpt-5","status":"in_progress"}}\n\n',
      'data: [DONE]\n\n',
    ];

    for await (const _message of parseResponsesStream(createSSEStream(chunks), {
      onStreamLiveness: listener,
    })) {
      void _message;
    }

    // The parser reports every successfully parsed lifecycle event; the
    // consumer (Turn) decides how to act on repeated pings.
    expect(livenessEvents).toHaveLength(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
