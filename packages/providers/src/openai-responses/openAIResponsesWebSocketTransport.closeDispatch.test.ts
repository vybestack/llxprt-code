/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createCodexResponsesWebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  drain,
  frame,
  metadataOf,
  options,
  request,
} from './openAIResponsesWebSocketTransport.test-helpers.js';

// Focused companion to the main transport suite. Kept separate so the main
// file stays within the max-lines budget while this pins the close-dispatch
// ordering invariant introduced when FakeSocket.close() started dispatching a
// close event like a real WebSocket.

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
