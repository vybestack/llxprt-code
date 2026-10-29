/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { afterEach, describe, expect, it } from 'bun:test';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { WsTransportSocket } from './responses-websocket-socket.js';
import {
  createCodexResponsesWebSocketTransport,
  streamOverWebSocketOrFallback,
  DEFAULT_WEBSOCKET_JSON_ENVELOPE_BYTES,
  type OpenTransportSocket,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import {
  drain,
  fallbackStream,
  options,
  request,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

const servers: WebSocketServer[] = [];
class ObservedSocket extends WsTransportSocket {
  constructor(
    socket: WebSocket,
    private readonly written: (fin: boolean) => void,
  ) {
    super(socket);
  }

  override async sendFragment(data: Uint8Array, fin: boolean): Promise<void> {
    await super.sendFragment(data, fin);
    this.written(fin);
  }
}

const transports: WebSocketTransport[] = [];

function messageBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.concat(data);
}

async function localServer(): Promise<{
  readonly server: WebSocketServer;
  readonly url: string;
}> {
  const server = new WebSocketServer({
    port: 0,
    maxPayload: 128 * 1024 * 1024,
  });
  servers.push(server);
  await once(server, 'listening');
  const address = server.address();
  if (typeof address !== 'object' || address === null)
    throw new Error('Expected local server address');
  return { server, url: `http://127.0.0.1:${address.port}/responses` };
}

function transport(openSocket?: OpenTransportSocket): WebSocketTransport {
  const result = createCodexResponsesWebSocketTransport({ openSocket });
  transports.push(result);
  return result;
}

function acknowledge(server: WebSocketServer): Promise<{
  readonly bytes: number;
  readonly hash: string;
  readonly binary: boolean;
}> {
  return new Promise((resolve) => {
    server.on('connection', (socket) => {
      socket.on('message', (data, binary) => {
        const bytes = messageBuffer(data);
        resolve({
          bytes: bytes.length,
          hash: createHash('sha256').update(bytes).digest('hex'),
          binary,
        });
        socket.send(
          JSON.stringify({
            type: 'response.completed',
            response: { id: 'local', status: 'completed' },
          }),
        );
      });
    });
  });
}

function census(): {
  readonly track: (chunk: Uint8Array) => void;
  readonly live: () => Promise<number>;
} {
  const references = new Set<WeakRef<Uint8Array>>();
  return {
    track(chunk): void {
      references.add(new WeakRef(chunk));
    },
    async live(): Promise<number> {
      await setImmediate();
      Bun.gc(true);
      for (const reference of references) {
        if (reference.deref() === undefined) references.delete(reference);
      }
      return references.size;
    },
  };
}

describe('Responses WebSocket streaming on a local server', () => {
  afterEach(async () => {
    for (const transport of transports.splice(0)) transport.close();
    for (const server of servers.splice(0)) {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('writes each fragment before demanding the next source chunk', async () => {
    const { server, url } = await localServer();
    const received = acknowledge(server);
    let written = 0;
    let finalFrames = 0;
    const fallback = { calls: 0 };
    const sender = transport(
      (endpoint, headers) =>
        new ObservedSocket(new WebSocket(endpoint, { headers }), (fin) => {
          if (fin) finalFrames += 1;
          else written += 1;
        }),
    );
    await drain(
      streamOverWebSocketOrFallback(
        sender,
        request(),
        options({
          responsesURL: url,
          requestFrameByteLength: 12,
          async *requestFrameBytes(): AsyncGenerator<Uint8Array> {
            for (let index = 0; index < 3; index += 1) {
              if (written !== index)
                throw new Error('BUFFERING_TRAP: read ahead of network write');
              yield new Uint8Array(4).fill(index);
            }
          },
        }),
        fallbackStream('HTTP', fallback),
        undefined,
        undefined,
      ),
    );
    expect((await received).bytes).toBe(12);
    expect({ written, finalFrames, fallback: fallback.calls }).toStrictEqual({
      written: 3,
      finalFrames: 1,
      fallback: 0,
    });
  });

  for (const declared of [3, 5]) {
    it(`terminates a byte-count mismatch (${declared}) before delivering a message`, async () => {
      const { server, url } = await localServer();
      let messages = 0;
      const closed = new Promise<void>((resolve) => {
        server.on('connection', (socket) => {
          socket.on('message', () => {
            messages += 1;
          });
          socket.on('close', () => resolve());
        });
      });
      await expect(
        drain(
          transport().streamResponse(
            request(),
            options({
              responsesURL: url,
              requestFrameByteLength: declared,
              async *requestFrameBytes(): AsyncGenerator<Uint8Array> {
                yield new Uint8Array(2);
                yield new Uint8Array(2);
              },
            }),
          ),
        ),
      ).rejects.toMatchObject({ name: 'ResponsesWebSocketFragmentError' });
      await closed;
      expect(messages).toBe(0);
    });
  }

  it('delivers no message when the peer closes during a fragmented send', async () => {
    const { server, url } = await localServer();
    let messages = 0;
    const closed = new Promise<void>((resolve) => {
      server.on('connection', (socket) => {
        socket.on('message', () => {
          messages += 1;
        });
        socket.on('ping', () => socket.terminate());
        socket.on('close', () => resolve());
      });
    });
    let clientClosed = Promise.resolve();
    const sender = transport((endpoint, headers) => {
      const socket = new WebSocket(endpoint, { headers });
      clientClosed = new Promise<void>((resolve) =>
        socket.once('close', () => resolve()),
      );
      return new ObservedSocket(socket, (fin) => {
        if (!fin) socket.ping();
      });
    });
    await expect(
      drain(
        sender.streamResponse(
          request(),
          options({
            responsesURL: url,
            requestFrameByteLength: 8,
            async *requestFrameBytes(): AsyncGenerator<Uint8Array> {
              yield new Uint8Array(4);
              await clientClosed;
              yield new Uint8Array(4);
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({ name: 'ResponsesWebSocketFragmentError' });
    await closed;
    expect(messages).toBe(0);
  });

  it('does not hide fragment rejection behind sticky HTTP fallback', async () => {
    const { server, url } = await localServer();
    server.on('connection', (socket) => {
      socket.on('message', () =>
        socket.close(1003, 'fragmented requests rejected'),
      );
    });
    const fallback = { calls: 0 };
    let sticky = 0;
    await expect(
      drain(
        streamOverWebSocketOrFallback(
          transport(),
          request(),
          options({
            responsesURL: url,
            requestFrameByteLength: 4,
            async *requestFrameBytes(): AsyncGenerator<Uint8Array> {
              yield new Uint8Array(4);
            },
          }),
          fallbackStream('HTTP', fallback),
          () => {
            sticky += 1;
          },
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ name: 'ResponsesWebSocketFragmentError' });
    expect({ fallback: fallback.calls, sticky }).toStrictEqual({
      fallback: 0,
      sticky: 0,
    });
  });

  it('handles an oversized streamed envelope within the HTTP fallback boundary', async () => {
    const { url } = await localServer();
    const fallback = { calls: 0 };
    let read = false;
    await drain(
      streamOverWebSocketOrFallback(
        transport(),
        request(),
        options({
          responsesURL: url,
          requestFrameByteLength: DEFAULT_WEBSOCKET_JSON_ENVELOPE_BYTES + 1,
          async *requestFrameBytes(): AsyncGenerator<Uint8Array> {
            read = true;
            yield new Uint8Array(1);
          },
        }),
        fallbackStream('HTTP', fallback),
        undefined,
        undefined,
      ),
    );
    expect({ calls: fallback.calls, read }).toStrictEqual({
      calls: 1,
      read: false,
    });
  });

  it('aborts a partial message without completing it or falling back', async () => {
    const { server, url } = await localServer();
    const controller = new AbortController();
    let messages = 0;
    const closed = new Promise<void>((resolve) => {
      server.on('connection', (socket) => {
        socket.on('message', () => {
          messages += 1;
        });
        socket.on('close', () => resolve());
      });
    });
    const fallback = { calls: 0 };
    await expect(
      drain(
        streamOverWebSocketOrFallback(
          transport(),
          request(),
          options({
            responsesURL: url,
            abortSignal: controller.signal,
            requestFrameByteLength: 8,
            async *requestFrameBytes(): AsyncGenerator<Uint8Array> {
              yield new Uint8Array(4);
              controller.abort();
              yield new Uint8Array(4);
            },
          }),
          fallbackStream('HTTP', fallback),
          undefined,
          undefined,
        ),
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    await closed;
    expect({ messages, calls: fallback.calls }).toStrictEqual({
      messages: 0,
      calls: 0,
    });
  });

  it('delivers multiple body chunks as exactly one binary message', async () => {
    const { server, url } = await localServer();
    const received = acknowledge(server);
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        ...request(),
        type: 'response.create',
        text: '🌕 café',
      }),
    );
    await drain(
      transport().streamResponse(
        request(),
        options({
          responsesURL: url,
          requestFrameByteLength: bytes.length,
          async *requestFrameBytes(): AsyncGenerator<Uint8Array> {
            for (let start = 0; start < bytes.length; start += 7)
              yield bytes.subarray(start, start + 7);
          },
        }),
      ),
    );
    expect(await received).toStrictEqual({
      bytes: bytes.length,
      hash: createHash('sha256').update(bytes).digest('hex'),
      binary: true,
    });
  });

  it('streams a 64 MiB session with a bounded live chunk census', async () => {
    const { server, url } = await localServer();
    const received = acknowledge(server);
    const chunks = census();
    const expected = createHash('sha256');
    let highWater = 0;
    const count = 16384;
    const size = 4096;
    await drain(
      transport().streamResponse(
        request(),
        options({
          responsesURL: url,
          requestFrameByteLength: count * size,
          async *requestFrameBytes(): AsyncGenerator<Uint8Array> {
            for (let index = 0; index < count; index += 1) {
              if (index % 512 === 0) {
                highWater = Math.max(highWater, await chunks.live());
                if (highWater > 4)
                  throw new Error('BUFFERING_TRAP: retained body chunks');
              }
              const chunk = new Uint8Array(size).fill(index % 251);
              chunks.track(chunk);
              expected.update(chunk);
              yield chunk;
            }
          },
        }),
      ),
    );
    expect(highWater).toBeLessThanOrEqual(4);
    expect(await received).toStrictEqual({
      bytes: count * size,
      hash: expected.digest('hex'),
      binary: true,
    });
  });

  it('rejects an assembling control with the same live chunk census', async () => {
    const chunks = census();
    async function* body(): AsyncGenerator<Uint8Array> {
      for (let index = 0; index < 16384; index += 1) {
        if (index % 512 === 0 && (await chunks.live()) > 4)
          throw new Error('BUFFERING_TRAP: retained body chunks');
        const chunk = new Uint8Array(4096).fill(index % 251);
        chunks.track(chunk);
        yield chunk;
      }
    }
    async function assemble(): Promise<Uint8Array> {
      const retained: Uint8Array[] = [];
      for await (const chunk of body()) retained.push(chunk);
      return Buffer.concat(retained);
    }
    await expect(assemble()).rejects.toThrow(
      'BUFFERING_TRAP: retained body chunks',
    );
  });
});
