/**
 * @license
 * Copyright 2025 Vybestack LLC
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
  completingScript,
  complete,
  drain,
  doneScript,
  fallbackStream,
  frame,
  incompleteScript,
  metadataOf,
  options,
  parsedObject,
  request,
  textContent,
} from './openAIResponsesWebSocketTransport.test-helpers.js';

describe('Codex Responses WebSocket transport', () => {
  it('sends a flat response.create request and converts the endpoint URL', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await drain(transport.streamResponse(request(), options()));

    const payload = parsedObject(harness.sockets[0].sent[0]);
    expect(Reflect.get(payload, 'type')).toBe('response.create');
    expect(Reflect.get(payload, 'model')).toBe('gpt-5.6-sol');
    expect(Reflect.get(payload, 'stream')).toBe(true);
    expect(Array.isArray(Reflect.get(payload, 'input'))).toBe(true);
    expect(Reflect.has(payload, 'response')).toBe(false);
    expect(harness.urls).toStrictEqual([
      'wss://chatgpt.com/backend-api/codex/responses',
    ]);
  });

  it('passes every current handshake header to the connector', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const headers = {
      Authorization: 'Bearer secret',
      'ChatGPT-Account-ID': 'account',
      originator: 'codex_cli_rs',
      session_id: 'session',
      'X-Custom': 'custom',
      'OpenAI-Beta': 'responses_websockets=2026-02-06',
    };

    await drain(transport.streamResponse(request(), options({ headers })));

    expect(harness.headers).toStrictEqual([headers]);
  });

  it('feeds text frames through the existing Responses parser', async () => {
    const harness = new SocketHarness([completingScript('Hello')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );

    expect(messages).toContainEqual(textContent('Hello'));
  });

  it('reuses one connection for sequential requests', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await drain(transport.streamResponse(request(), options()));
    await drain(transport.streamResponse(request(), options()));

    expect(harness.sockets).toHaveLength(1);
    expect(harness.sockets[0].sent).toHaveLength(2);
  });

  it('rejects an already-aborted request without sending on a reused connection', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    await drain(transport.streamResponse(request(), options()));
    const controller = new AbortController();
    controller.abort();

    await expect(
      drain(
        transport.streamResponse(
          request(),
          options({ abortSignal: controller.signal }),
        ),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.sockets[0].sent).toHaveLength(1);
  });

  it('serializes concurrent requests until response.completed', async () => {
    let requestCount = 0;
    let firstRequestSent = (): void => undefined;
    const firstSend = new Promise<void>((resolve) => {
      firstRequestSent = resolve;
    });
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          requestCount += 1;
          if (requestCount === 1) firstRequestSent();
          else complete(socket);
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const first = drain(transport.streamResponse(request(), options()));
    const second = drain(transport.streamResponse(request(), options()));
    await firstSend;
    expect(harness.sockets[0].sent).toHaveLength(1);

    complete(harness.sockets[0]);
    await first;
    await second;
    expect(harness.sockets[0].sent).toHaveLength(2);
  });

  it('promptly rejects a request aborted while queued without sending it', async () => {
    let firstRequestSent = (): void => undefined;
    const firstSend = new Promise<void>((resolve) => {
      firstRequestSent = resolve;
    });
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => firstRequestSent();
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const controller = new AbortController();
    const first = drain(transport.streamResponse(request(), options()));
    const second = drain(
      transport.streamResponse(
        request(),
        options({ abortSignal: controller.signal }),
      ),
    );
    await firstSend;

    controller.abort();

    const result = second.then(
      () => 'completed',
      (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
    );
    expect(await result).toBe('AbortError');
    expect(harness.sockets[0].sent).toHaveLength(1);
    complete(harness.sockets[0]);
    await first;
  });

  it('reconnects when the endpoint or a handshake header changes', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await drain(transport.streamResponse(request(), options()));
    await drain(
      transport.streamResponse(
        request(),
        options({
          responsesURL: 'http://localhost:8080/responses',
          headers: { Authorization: 'Bearer changed' },
        }),
      ),
    );

    expect(harness.sockets).toHaveLength(2);
    expect(harness.urls[1]).toBe('ws://localhost:8080/responses');
    expect(harness.sockets[0].closedByClient).toBe(true);
  });

  it('closes a connecting socket and rejects AbortError', async () => {
    const harness = new SocketHarness([() => undefined]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const controller = new AbortController();
    const result = drain(
      transport.streamResponse(
        request(),
        options({ abortSignal: controller.signal }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.sockets[0].closedByClient).toBe(true);
  });

  it('closes and rejects when the handshake stalls', async () => {
    const harness = new SocketHarness([() => undefined]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
      handshakeTimeoutMs: 50,
    });
    const result = drain(transport.streamResponse(request(), options()));
    const assertion = result.then(
      () => 'completed',
      (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
    );
    // Wait for the injected handshake timeout to fire.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await assertion).toBe('StreamInterruptionError');
    expect(harness.sockets[0].closedByClient).toBe(true);
  });

  it('closes a streaming socket on abort and reconnects later', async () => {
    const harness = new SocketHarness([
      (socket) => socket.open(),
      completingScript(),
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    const controller = new AbortController();
    const result = drain(
      transport.streamResponse(
        request(),
        options({ abortSignal: controller.signal }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(harness.sockets[0].closedByClient).toBe(true);
    await drain(transport.streamResponse(request(), options()));
    expect(harness.sockets).toHaveLength(2);
  });

  it.each([
    ['malformed JSON', 'not-json'],
    ['non-text data', new Uint8Array([1])],
  ])('fails explicitly for %s frames', async (_label, frame) => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => socket.message(frame);
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await expect(
      drain(transport.streamResponse(request(), options())),
    ).rejects.toThrow(/malformed JSON|non-text/);
  });

  it('fails when the server closes before response.completed', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => socket.serverClose();
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await expect(
      drain(transport.streamResponse(request(), options())),
    ).rejects.toThrow(/before response.completed/);
  });

  it('does not fall back after content has been yielded to the consumer', async () => {
    const transport: WebSocketTransport = {
      async *streamResponse() {
        yield textContent('partial');
        throw new Error('stream failed');
      },
      close() {},
    };

    await expect(
      drain(
        streamOverWebSocketOrFallback(
          transport,
          request(),
          options(),
          fallbackStream('unexpected fallback'),
          undefined,
          undefined,
        ),
      ),
    ).rejects.toThrow('stream failed');
  });

  it('falls back and reports sticky fallback before any response event', async () => {
    const fallback = { calls: 0 };
    let stickyCalls = 0;
    const transport: WebSocketTransport = {
      async *streamResponse() {
        yield await Promise.reject(new Error('connect failed'));
      },
      close() {},
    };

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

    expect(messages[0]).toStrictEqual(textContent('HTTP'));
    expect(fallback.calls).toBe(1);
    expect(stickyCalls).toBe(1);
  });

  it('close disposes the reusable connection', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    await drain(transport.streamResponse(request(), options()));

    transport.close();

    expect(harness.sockets[0].closedByClient).toBe(true);
  });

  it('treats response.incomplete as an accepted terminal, preserving text and metadata (defect 1)', async () => {
    const harness = new SocketHarness([incompleteScript('Hello')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );

    expect(messages).toContainEqual(textContent('Hello'));
    expect(metadataOf(messages)).toMatchObject({
      finishReason: 'incomplete',
      stopReason: 'max_tokens',
      incompleteReason: 'max_output_tokens',
      id: 'resp_incomplete',
    });
  });

  it('treats response.done as an accepted terminal, preserving text and metadata (defect 1)', async () => {
    const harness = new SocketHarness([doneScript('Done text')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );

    expect(messages).toContainEqual(textContent('Done text'));
    expect(metadataOf(messages)).toMatchObject({
      finishReason: 'completed',
      stopReason: 'end_turn',
      id: 'resp_done',
    });
  });

  it('falls back to HTTP when only a control frame arrived before close (defect 4)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({
              type: 'response.created',
              response: { id: 'r', status: 'in_progress' },
            }),
          );
          socket.serverClose();
        };
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

  it('does not leak buffered non-terminal frames when closed before the consumer reads (defect 3 + 4)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'WS leaked' }),
          );
          socket.serverClose();
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const messages = await drain(
      streamOverWebSocketOrFallback(
        transport,
        request(),
        options(),
        fallbackStream('HTTP'),
        () => undefined,
        undefined,
      ),
    );

    expect(messages).toStrictEqual([textContent('HTTP')]);
  });

  it('rejects with the socket-error message, not the close message, when error precedes close (defect 2)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.error();
          socket.serverClose();
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await expect(
      drain(transport.streamResponse(request(), options())),
    ).rejects.toThrow(/stream failed before/);
  });

  it('rejects with AbortError when abort precedes close (defect 2)', async () => {
    const controller = new AbortController();
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          controller.abort();
          socket.serverClose();
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
          options({ abortSignal: controller.signal }),
        ),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('never falls back once text content has been delivered to the consumer (anti-replay invariant)', async () => {
    let fallbackCalls = 0;
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
    });
    const iterator = streamOverWebSocketOrFallback(
      transport,
      request(),
      options(),
      async function* fallback() {
        fallbackCalls += 1;
        yield textContent('fallback');
      },
      () => undefined,
      undefined,
    );

    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toStrictEqual(textContent('partial'));

    harness.sockets[0].serverClose();

    await expect(iterator.next()).rejects.toThrow(/before response.completed/);
    expect(fallbackCalls).toBe(0);
    expect(
      harness.sockets[0].sent.filter((data) => data.length > 0),
    ).toHaveLength(1);
  });

  it('surfaces the response.failed provider error rather than the close message (defect 1 + 2)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({
              type: 'response.failed',
              response: {
                status: 'failed',
                error: { message: 'rate limited', type: 'rate_limit' },
              },
            }),
          );
          socket.serverClose();
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await expect(
      drain(transport.streamResponse(request(), options())),
    ).rejects.toThrow(/rate limited/);
  });

  it('surfaces a top-level error provider message rather than the close message (defect 1 + 2)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({
              type: 'error',
              message: 'server overloaded',
              code: 'overloaded',
              param: null,
              sequence_number: 7,
            }),
          );
          socket.serverClose();
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await expect(
      drain(transport.streamResponse(request(), options())),
    ).rejects.toThrow(/server overloaded/);
  });

  it('closes the socket when a handshake error fires (defect 6)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        queueMicrotask(() => socket.error());
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await expect(
      drain(transport.streamResponse(request(), options())),
    ).rejects.toMatchObject({ name: 'StreamInterruptionError' });
    expect(harness.sockets[0].closedByClient).toBe(true);
  });

  it('invokes the caller-supplied onResponseEvent through streamOverWebSocketOrFallback (defect 5)', async () => {
    let callerEvents = 0;
    const harness = new SocketHarness([completingScript('Hi')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await drain(
      streamOverWebSocketOrFallback(
        transport,
        request(),
        options({
          onResponseEvent: () => {
            callerEvents += 1;
          },
        }),
        fallbackStream('unexpected'),
        () => undefined,
        undefined,
      ),
    );

    expect(callerEvents).toBeGreaterThan(0);
  });

  it('attaches close diagnostics (code/reason/wasClean) to the interruption error (defect 7)', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () =>
          socket.serverClose({
            code: 1011,
            reason: 'server crash',
            wasClean: false,
          });
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const error = await drain(
      transport.streamResponse(request(), options()),
    ).then(
      () => undefined,
      (caught: unknown) => (caught instanceof Error ? caught : undefined),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      details: {
        closeInfo: { code: 1011, reason: 'server crash', wasClean: false },
      },
    });
  });

  it('keeps the socket reusable after response.incomplete (socket reuse invariant)', async () => {
    const harness = new SocketHarness([incompleteScript('Hi', false)]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await drain(transport.streamResponse(request(), options()));
    await drain(transport.streamResponse(request(), options()));

    expect(harness.sockets).toHaveLength(1);
  });

  it('keeps the socket reusable after response.done (socket reuse invariant)', async () => {
    const harness = new SocketHarness([doneScript('Hi', false)]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    await drain(transport.streamResponse(request(), options()));
    await drain(transport.streamResponse(request(), options()));

    expect(harness.sockets).toHaveLength(1);
  });

  // --- Finding 1: onResponseEvent reentrancy ---

  it('a throwing onResponseEvent does not break the stream (finding 1)', async () => {
    const harness = new SocketHarness([completingScript('Hello')]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const messages = await drain(
      transport.streamResponse(
        request(),
        options({
          onResponseEvent: () => {
            throw new Error('callback explosion');
          },
        }),
      ),
    );

    expect(messages).toContainEqual(textContent('Hello'));
  });

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

  // --- Finding 2: close between handshake and stream-listener attachment ---

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

  // --- Finding 5: ordering-sensitive behavioural tests ---

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

    await iterator.return();

    const messages = await drain(
      transport.streamResponse(request(), options()),
    );
    expect(messages).toContainEqual(textContent('second'));
    expect(harness.sockets).toHaveLength(2);
  });
});
