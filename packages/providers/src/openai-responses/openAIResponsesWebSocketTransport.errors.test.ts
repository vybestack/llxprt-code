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
  drain,
  fallbackStream,
  frame,
  options,
  request,
  textContent,
} from './openAIResponsesWebSocketTransport.test-helpers.js';

describe('Codex Responses WebSocket transport failures', () => {
  it('a throwing onResponseEvent does not strand a waiting reader (finding 1)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const iterator = transport.streamResponse(
      request(),
      options({
        onResponseEvent: () => {
          throw new Error('callback explosion');
        },
      }),
    );

    const readPromise = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.sockets[0].message(
      frame({ type: 'response.output_text.delta', delta: 'Hello' }),
    );

    const result = await readPromise;
    expect(result.done).toBe(false);
    expect(result.value).toStrictEqual(textContent('Hello'));
  });

  it('a synchronously aborting onResponseEvent rejects with AbortError and does not hang (finding 1)', async () => {
    const controller = new AbortController();
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'partial' }),
          );
          socket.message(
            frame({
              type: 'response.completed',
              response: { id: 'r', status: 'completed' },
            }),
          );
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await expect(
      drain(
        transport.streamResponse(
          request(),
          options({
            abortSignal: controller.signal,
            onResponseEvent: () => controller.abort(),
          }),
        ),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects promptly when the socket closes before the request is sent (finding 2)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.serverClose();
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await expect(
      drain(transport.streamResponse(request(), options())),
    ).rejects.toThrow(/before the request was sent/);
  });

  it('falls back to HTTP when the socket closes before the request is sent (finding 2)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.serverClose();
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    let stickyCalls = 0;

    const messages = await drain(
      streamOverWebSocketOrFallback(
        transport,
        request(),
        options(),
        fallbackStream('HTTP'),
        () => {
          stickyCalls += 1;
        },
        undefined,
      ),
    );

    expect(messages).toStrictEqual([textContent('HTTP')]);
    expect(stickyCalls).toBe(1);
  });

  it('a recorded failure takes precedence over an already-queued non-terminal frame (finding 5)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'first' }),
          );
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const iterator = transport.streamResponse(request(), options());

    const first = await iterator.next();
    expect(first.value).toStrictEqual(textContent('first'));
    harness.sockets[0].message(
      frame({ type: 'response.output_text.delta', delta: 'queued' }),
    );
    harness.sockets[0].serverClose();

    await expect(iterator.next()).rejects.toThrow(/before response.completed/);
  });

  it.each([
    ['malformed JSON', 'not-json'],
    ['non-text data', new Uint8Array([1])],
  ])(
    'reports the %s error rather than a subsequent close (finding 5)',
    async (_label, badFrame) => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            socket.message(badFrame);
            socket.serverClose();
          };
        },
      ]);
      const transport = createCodexResponsesWebSocketTransport({
        openSocket: harness.openSocket,
      });

      await expect(
        drain(transport.streamResponse(request(), options())),
      ).rejects.toThrow(/malformed JSON|non-text/);
    },
  );

  it('consumer cancellation detaches cleanly and allows a subsequent request (finding 5)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'partial' }),
          );
        };
      },
      completingScript('second'),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const iterator = transport.streamResponse(request(), options());

    const first = await iterator.next();
    expect(first.value).toStrictEqual(textContent('partial'));
    if (iterator.return === undefined) {
      throw new Error('Expected cancellable response iterator');
    }
    await iterator.return();

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );
    expect(messages).toContainEqual(textContent('second'));
    expect(harness.sockets).toHaveLength(2);
  });
});
