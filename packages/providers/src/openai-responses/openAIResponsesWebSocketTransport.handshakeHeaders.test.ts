/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createCodexResponsesWebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  completingScript,
  drain,
  options,
  request,
} from './openAIResponsesWebSocketTransport.test-helpers.js';

describe('Codex Responses WebSocket handshake headers', () => {
  it('passes every current handshake header to the connector', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const headers = {
      Authorization: 'Bearer secret',
      'ChatGPT-Account-ID': 'account',
      originator: 'codex_cli_rs',
      'session-id': 'session',
      'thread-id': 'session',
      'x-client-request-id': 'session',
      'X-Custom': 'custom',
      'OpenAI-Beta': 'responses_websockets=2026-02-06',
    };

    await drain(transport.streamResponse(request(), options({ headers })));

    expect(harness.headers).toStrictEqual([headers]);
  });

  it('reconnects when a handshake identity header changes', async () => {
    const harness = new SocketHarness([completingScript(), completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await drain(
      transport.streamResponse(
        request(),
        options({ headers: { 'thread-id': 'thread-one' } }),
      ),
    );
    await drain(
      transport.streamResponse(
        request(),
        options({ headers: { 'thread-id': 'thread-two' } }),
      ),
    );

    expect(harness.sockets).toHaveLength(2);
    expect(harness.sockets[0].closedByClient).toBe(true);
  });
});
