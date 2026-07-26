/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  createCodexResponsesWebSocketTransport,
  streamOverWebSocketOrFallback,
  type OpenTransportSocket,
  type StreamResponseOptions,
  type TransportSocket,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';

type Listener<T> = (value: T) => void;

class FakeSocket implements TransportSocket {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readyState = this.CONNECTING;
  readonly sent: string[] = [];
  closed = false;
  onSend: ((data: string) => void) | undefined;
  private readonly openListeners = new Set<Listener<void>>();
  private readonly messageListeners = new Set<Listener<unknown>>();
  private readonly closeListeners = new Set<Listener<void>>();
  private readonly errorListeners = new Set<Listener<void>>();

  send(data: string): void {
    this.sent.push(data);
    this.onSend?.(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  onOpen(listener: Listener<void>): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  onMessage(listener: Listener<unknown>): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: Listener<void>): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  onError(listener: Listener<void>): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  open(): void {
    this.readyState = this.OPEN;
    for (const listener of this.openListeners) listener();
  }

  message(data: unknown): void {
    for (const listener of this.messageListeners) listener(data);
  }

  serverClose(): void {
    this.readyState = 3;
    for (const listener of this.closeListeners) listener();
  }
}

class SocketHarness {
  readonly sockets: FakeSocket[] = [];
  readonly urls: string[] = [];
  readonly headers: Array<Readonly<Record<string, string>>> = [];

  constructor(
    private readonly scripts: ReadonlyArray<(socket: FakeSocket) => void>,
  ) {}

  readonly openSocket: OpenTransportSocket = (url, headers) => {
    const socket = new FakeSocket();
    this.sockets.push(socket);
    this.urls.push(url);
    this.headers.push(headers);
    const script = this.scripts[this.sockets.length - 1] ?? this.scripts[0];
    queueMicrotask(() => script(socket));
    return socket;
  };
}

function request(): OpenAIResponsesRequest {
  return {
    model: 'gpt-5.6-sol',
    input: [{ role: 'user', content: 'Hello' }],
    stream: true,
  };
}

function options(
  overrides: Partial<StreamResponseOptions> = {},
): StreamResponseOptions {
  return {
    responsesURL: 'https://chatgpt.com/backend-api/codex/responses',
    headers: {
      Authorization: 'Bearer token',
      'ChatGPT-Account-ID': 'account',
      'OpenAI-Beta': 'responses_websockets=2026-02-06',
    },
    ...overrides,
  };
}

function complete(socket: FakeSocket, text?: string): void {
  if (text !== undefined) {
    socket.message(
      JSON.stringify({ type: 'response.output_text.delta', delta: text }),
    );
  }
  socket.message(
    JSON.stringify({
      type: 'response.completed',
      response: { id: 'response', status: 'completed' },
    }),
  );
}

function completingScript(text?: string): (socket: FakeSocket) => void {
  return (socket) => {
    socket.open();
    socket.onSend = () => complete(socket, text);
  };
}

async function drain(
  iterator: AsyncIterableIterator<IContent>,
): Promise<readonly IContent[]> {
  const messages: IContent[] = [];
  for await (const message of iterator) messages.push(message);
  return messages;
}

function parsedObject(serialized: string): object {
  const value: unknown = JSON.parse(serialized);
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected serialized request object');
  }
  return value;
}

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

    expect(messages).toContainEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Hello' }],
    });
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

  it('serializes concurrent requests until response.completed', async () => {
    let requestCount = 0;
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          requestCount += 1;
          if (requestCount === 2) complete(socket);
        };
      },
    ]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });

    const first = drain(transport.streamResponse(request(), options()));
    const second = drain(transport.streamResponse(request(), options()));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.sockets[0].sent).toHaveLength(1);

    complete(harness.sockets[0]);
    await first;
    await second;
    expect(harness.sockets[0].sent).toHaveLength(2);
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
    expect(harness.sockets[0].closed).toBe(true);
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
    expect(harness.sockets[0].closed).toBe(true);
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
    expect(harness.sockets[0].closed).toBe(true);
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

  it('does not fall back after a valid response event has arrived', async () => {
    let fallbackCalls = 0;
    const transport: WebSocketTransport = {
      async *streamResponse(_request, streamOptions) {
        streamOptions.onResponseEvent?.();
        yield await Promise.reject(new Error('stream failed'));
      },
      close() {},
    };

    await expect(
      drain(
        streamOverWebSocketOrFallback(
          transport,
          request(),
          options(),
          async function* fallback() {
            fallbackCalls += 1;
            yield {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'unexpected fallback' }],
            };
          },
          undefined,
          undefined,
        ),
      ),
    ).rejects.toThrow('stream failed');
    expect(fallbackCalls).toBe(0);
  });

  it('falls back and reports sticky fallback before any response event', async () => {
    let fallbackCalls = 0;
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
        async function* fallback() {
          fallbackCalls += 1;
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'HTTP' }],
          };
        },
        () => {
          stickyCalls += 1;
        },
        undefined,
      ),
    );

    expect(messages[0]).toStrictEqual({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'HTTP' }],
    });
    expect(fallbackCalls).toBe(1);
    expect(stickyCalls).toBe(1);
  });

  it('close disposes the reusable connection', async () => {
    const harness = new SocketHarness([completingScript()]);
    const transport = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    });
    await drain(transport.streamResponse(request(), options()));

    transport.close();

    expect(harness.sockets[0].closed).toBe(true);
  });
});
