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
  connectionLimitErrorFrame,
  connectionLimitScript,
  drain,
  frame,
  metadataOf,
  options,
  request,
  textContent,
} from './openAIResponsesWebSocketTransport.test-helpers.js';

describe('Codex Responses WebSocket connection-lifecycle retry @issue:2771', () => {
  it('B1: reconnects and retries once on connection-limit, then completes', async () => {
    const harness = new SocketHarness([
      connectionLimitScript(),
      completingScript('recovered'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );

    expect(messages).toContainEqual(textContent('recovered'));
    expect(metadataOf(messages)).toMatchObject({
      finishReason: 'completed',
    });
    expect(harness.sockets).toHaveLength(2);
    expect(harness.sockets[0].closedByClient).toBe(true);
  });

  it('B2: fails clearly when the retry also hits the connection limit', async () => {
    const harness = new SocketHarness([
      connectionLimitScript(),
      connectionLimitScript(),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const rejection = await drain(
      transport.streamResponse(request(), options()),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejection).toMatchObject({
      name: 'StreamInterruptionError',
      details: {
        providerError: { code: 'websocket_connection_limit_reached' },
      },
    });
    expect(String((rejection as Error).message)).toMatch(
      /reached the connection lifecycle limit/,
    );

    expect(harness.sockets).toHaveLength(2);
  });

  it('B3: does not retry an unrelated top-level error', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () =>
          socket.message(
            frame({
              type: 'error',
              message: 'server overloaded',
              code: 'overloaded',
            }),
          );
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await expect(
      drain(transport.streamResponse(request(), options())),
    ).rejects.toThrow(/server overloaded/);

    expect(harness.sockets).toHaveLength(1);
  });

  it('B4: does not reconnect after real output has been yielded', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'partial' }),
          );
          socket.message(connectionLimitErrorFrame());
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const iterator = transport.streamResponse(request(), options());

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toStrictEqual(textContent('partial'));

    await expect(iterator.next()).rejects.toThrow(/has been open for too long/);

    expect(harness.sockets).toHaveLength(1);
    expect(
      harness.sockets[0].sent.filter((data) => data.length > 0),
    ).toHaveLength(1);
  });

  it('B5: abort during reconnect never retries and later requests reconnect', async () => {
    const controller = new AbortController();
    let secondSend: (() => void) | undefined;
    const secondSendPromise = new Promise<void>((resolve) => {
      secondSend = resolve;
    });
    const harness = new SocketHarness([
      connectionLimitScript(),
      (socket) => {
        socket.open();
        socket.onSend = () => secondSend?.();
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const result = drain(
      transport.streamResponse(
        request(),
        options({ abortSignal: controller.signal }),
      ),
    );

    await secondSendPromise;
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.sockets).toHaveLength(2);
    expect(harness.sockets[0].closedByClient).toBe(true);

    // Reuse the original transport: recovery after a mid-reconnect abort
    // (turn lock released, retired active socket dropped) must work on the
    // SAME transport instance, not just on a fresh one.
    harness.appendScript(completingScript('later'));
    const messages = await drain(
      transport.streamResponse(request(), options()),
    );
    expect(messages).toContainEqual(textContent('later'));
    expect(harness.sockets).toHaveLength(3);
  });
});
