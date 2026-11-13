/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  trackConnection,
  type EndpointReply,
  type ReplyResponder,
  type ScriptedEndpoint,
  type WireRequest,
} from './refusal-endpoint.js';

const PROMPT_TOKENS = 120;

function event(name: string, data: object): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Anthropic stop reason for the finish reason a test script names. */
function stopReason(finishReason: string): string {
  return finishReason === 'stop' ? 'end_turn' : finishReason;
}

/**
 * Renders one scripted answer as an Anthropic Messages SSE stream. A reply
 * without text is the real-world metadata-only refusal: `message_start`, then
 * a `message_delta` carrying `stop_reason: "refusal"` and zero output tokens,
 * with no content block in between.
 */
function renderAnthropicReply(reply: EndpointReply): string {
  if (reply.kind !== 'finish')
    throw new Error('The Anthropic endpoint scripts finish replies only');
  const start = event('message_start', {
    type: 'message_start',
    message: {
      id: 'msg_scripted',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: PROMPT_TOKENS, output_tokens: 0 },
    },
  });
  const text =
    reply.text === undefined
      ? ''
      : event('content_block_start', {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }) +
        event('content_block_delta', {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: reply.text },
        }) +
        event('content_block_stop', { type: 'content_block_stop', index: 0 });
  return (
    start +
    text +
    event('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason(reply.finishReason),
        stop_sequence: null,
      },
      usage: { output_tokens: reply.outputTokens },
    }) +
    event('message_stop', { type: 'message_stop' })
  );
}

/**
 * A local Anthropic Messages endpoint answering request N with reply N, or with
 * whatever a responder decides from the request itself. A request beyond the
 * script gets a marker answer and is still recorded.
 */
export async function startAnthropicEndpoint(
  replies: readonly EndpointReply[] | ReplyResponder,
): Promise<ScriptedEndpoint> {
  const requests: WireRequest[] = [];
  const disconnected: number[] = [];
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const buffers: Buffer[] = [];
      for await (const part of request) buffers.push(Buffer.from(part));
      const body = JSON.parse(
        Buffer.concat(buffers).toString('utf8'),
      ) as WireRequest;
      requests.push(body);
      const index = requests.length - 1;
      const connection = trackConnection(response, index, disconnected);
      const scripted =
        typeof replies === 'function'
          ? await replies(body, index, connection)
          : replies.find((_, position) => position === index);
      const reply = scripted ?? {
        kind: 'finish' as const,
        finishReason: 'stop',
        text: 'UNSCRIPTED REQUEST: the agent asked for more than expected',
        outputTokens: 12,
      };
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(renderAnthropicReply(reply));
    })().catch((error: unknown) =>
      response.destroy(error instanceof Error ? error : undefined),
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing local endpoint port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests: () => requests,
    disconnectedRequests: () => disconnected,
    stop: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
