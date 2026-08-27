/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  createCodexResponsesWebSocketTransport,
  streamOverWebSocketOrFallback,
} from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  completingScript,
  complete,
  drain,
  fallbackStream,
  frame,
  options,
  request,
  textContent,
} from './openAIResponsesWebSocketTransport.test-helpers.js';

describe('Codex Responses WebSocket stream idle timeout', () => {
  it('interrupts a silent stream, closes its socket, and reconnects for the next request', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => undefined;
      },
      completingScript('second'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
      streamIdleTimeoutMs: 50,
    });

    await expect(
      drain(transport.streamResponse(request(), options())),
    ).rejects.toMatchObject({
      name: 'StreamInterruptionError',
      message: expect.stringMatching(/idle timeout/),
    });
    expect(harness.sockets[0].closedByClient).toBe(true);

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );
    expect(messages).toContainEqual(textContent('second'));
    expect(harness.sockets).toHaveLength(2);
  });

  it('resets the timeout when valid frames keep arriving', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          setTimeout(
            () =>
              socket.message(
                frame({
                  type: 'response.output_text.delta',
                  delta: 'tick',
                }),
              ),
            80,
          );
          setTimeout(
            () =>
              socket.message(
                frame({
                  type: 'response.output_text.delta',
                  delta: 'tick',
                }),
              ),
            160,
          );
          setTimeout(
            () =>
              socket.message(
                frame({
                  type: 'response.output_text.delta',
                  delta: 'tick',
                }),
              ),
            240,
          );
          setTimeout(() => complete(socket), 320);
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
      streamIdleTimeoutMs: 200,
    });

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );
    const text = messages
      .flatMap((message) => message.blocks)
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    expect(text).toBe('tickticktick');
  });

  it('preserves AbortError after an abort during the idle window', async () => {
    const controller = new AbortController();
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => undefined;
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
      streamIdleTimeoutMs: 50,
    });
    const settled = drain(
      transport.streamResponse(
        request(),
        options({ abortSignal: controller.signal }),
      ),
    ).then(
      () => 'completed',
      (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();

    const initialOutcome = await settled;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect([initialOutcome, await settled]).toStrictEqual([
      'AbortError',
      'AbortError',
    ]);
  });

  it('clears the timeout after a terminal frame and reuses the socket', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
      streamIdleTimeoutMs: 50,
    });

    await drain(transport.streamResponse(request(), options()));
    await new Promise((resolve) => setTimeout(resolve, 120));
    await drain(transport.streamResponse(request(), options()));

    expect(harness.sockets).toHaveLength(1);
  });

  it('does not fall back after the idle timeout interrupts partial output', async () => {
    const fallback = { calls: 0 };
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'partial' }),
          );
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
      streamIdleTimeoutMs: 50,
    });
    const iterator = streamOverWebSocketOrFallback(
      transport,
      request(),
      options(),
      fallbackStream('HTTP', fallback),
      undefined,
      undefined,
    );

    const first = await iterator.next();
    expect(first.value).toStrictEqual(textContent('partial'));

    await expect(iterator.next()).rejects.toThrow(/idle timeout/);
    expect(fallback.calls).toBe(0);
  });

  it('closes the socket on idle expiry while the consumer is paused after partial output', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'partial' }),
          );
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
      streamIdleTimeoutMs: 50,
    });
    const iterator = transport.streamResponse(request(), options());

    // The generator stays suspended at this yield until the final next() call,
    // so only the transport's eager invalidation can close the socket.
    const first = await iterator.next();
    expect(first.value).toStrictEqual(textContent('partial'));

    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(harness.sockets[0].closedByClient).toBe(true);

    await expect(iterator.next()).rejects.toMatchObject({
      name: 'StreamInterruptionError',
      message: expect.stringMatching(/idle timeout/),
    });
  });

  it('falls back to HTTP once after a pre-event idle timeout', async () => {
    const fallback = { calls: 0 };
    let stickyCalls = 0;
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => undefined;
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
      streamIdleTimeoutMs: 50,
    });

    const messages = await drain(
      streamOverWebSocketOrFallback(
        transport,
        request(),
        options(),
        fallbackStream('HTTP', fallback),
        () => {
          stickyCalls += 1;
        },
        undefined,
      ),
    );

    expect(messages).toStrictEqual([textContent('HTTP')]);
    expect(fallback.calls).toBe(1);
    // One pre-output fallback reports the failure to the provider; it does not
    // by itself demote the session to HTTP (that needs the provider's
    // consecutive-failure threshold).
    expect(stickyCalls).toBe(1);
  });
});
