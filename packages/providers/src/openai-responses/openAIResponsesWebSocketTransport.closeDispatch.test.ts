/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  createCodexResponsesWebSocketTransport,
  streamOverWebSocketOrFallback,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  drain,
  fallbackStream,
  frame,
  metadataOf,
  options,
  request,
  textContent,
} from './openAIResponsesWebSocketTransport.test-helpers.js';

// Focused companion to the main transport suite. Kept separate so the main
// file stays within the max-lines budget while this pins invariants that were
// introduced when FakeSocket.close() started dispatching a close event like a
// real WebSocket (close-dispatch ordering) and when the consecutive-failure
// sticky-fallback policy arrived (success/fallback notification seams).

describe('Codex Responses WebSocket transport close-dispatch ordering', () => {
  it('a transport-initiated close during an active request does not corrupt an already-recorded terminal outcome (finding 6)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({
              type: 'response.incomplete',
              response: {
                id: 'r',
                status: 'incomplete',
                incomplete_details: { reason: 'max_output_tokens' },
              },
            }),
          );
          // A client (transport) close now dispatches a close event to the
          // still-active frame source; the recorded terminal must win.
          socket.close();
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );

    expect(metadataOf(messages)?.finishReason).toBe('incomplete');
  });
});

describe('Codex Responses WebSocket transport fallback notification seams', () => {
  it('notifies onSuccess when the WebSocket completes without falling back (issue #3034 B1)', async () => {
    const transport: WebSocketTransport = {
      async *streamResponse() {
        yield textContent('ws text');
      },
      close() {},
    };
    let successCalls = 0;
    let fallbackCalls = 0;

    const messages = await drain(
      streamOverWebSocketOrFallback(
        transport,
        request(),
        options(),
        fallbackStream('unexpected'),
        () => {
          fallbackCalls += 1;
        },
        undefined,
        () => {
          successCalls += 1;
        },
      ),
    );

    expect(messages).toStrictEqual([textContent('ws text')]);
    expect(successCalls).toBe(1);
    expect(fallbackCalls).toBe(0);
  });

  it('does not notify onSuccess and does notify onFallback for a pre-output failure (issue #3034 B1)', async () => {
    const transport: WebSocketTransport = {
      async *streamResponse() {
        yield await Promise.reject(new TypeError('connect ECONNREFUSED'));
      },
      close() {},
    };
    let successCalls = 0;
    let fallbackCalls = 0;

    const messages = await drain(
      streamOverWebSocketOrFallback(
        transport,
        request(),
        options(),
        fallbackStream('HTTP'),
        () => {
          fallbackCalls += 1;
        },
        undefined,
        () => {
          successCalls += 1;
        },
      ),
    );

    expect(messages).toStrictEqual([textContent('HTTP')]);
    expect(fallbackCalls).toBe(1);
    expect(successCalls).toBe(0);
  });
});
