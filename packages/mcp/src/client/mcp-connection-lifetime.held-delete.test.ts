/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { closeClientWithTimeout } from './close-client-with-timeout.js';
import { createJoiningTransport } from './mcp-connection-lifetime.js';

interface HeldDeleteServer {
  readonly url: URL;
  readonly deleteReceived: Promise<void>;
  readonly deleteAborted: Promise<void>;
  liveSockets(): number;
}

const servers: Server[] = [];
const sockets = new Set<Socket>();

async function startHeldDeleteServer(): Promise<HeldDeleteServer> {
  let markReceived: () => void = () => undefined;
  let markAborted: () => void = () => undefined;
  const deleteReceived = new Promise<void>((resolve) => {
    markReceived = resolve;
  });
  const deleteAborted = new Promise<void>((resolve) => {
    markAborted = resolve;
  });
  const server = createServer((request, response) => {
    if (request.method === 'DELETE') {
      request.resume();
      response.on('close', () => {
        if (!response.writableEnded) markAborted();
      });
      markReceived();
      return;
    }
    if (request.method === 'GET') {
      response.writeHead(405, { connection: 'close' }).end();
      return;
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      const message = JSON.parse(body) as { id?: number; method?: string };
      if (message.method === 'initialize') {
        response
          .writeHead(200, {
            connection: 'close',
            'content-type': 'application/json',
            'mcp-session-id': 'held-delete-session',
          })
          .end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                protocolVersion: '2025-06-18',
                capabilities: {},
                serverInfo: { name: 'held-delete', version: '0' },
              },
            }),
          );
        return;
      }
      response.writeHead(202, { connection: 'close' }).end();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected a TCP address');
  return {
    url: new URL(`http://127.0.0.1:${address.port}/mcp`),
    deleteReceived,
    deleteAborted,
    liveSockets: () => sockets.size,
  };
}

async function connectClient(
  url: URL,
  ownerSignal?: AbortSignal,
): Promise<Client> {
  const client = new Client({ name: 'held-delete-test', version: '0' });
  await client.connect(
    createJoiningTransport(
      (fetch) => new StreamableHTTPClientTransport(url, { fetch }),
      ownerSignal,
    ),
  );
  return client;
}

async function failureOf(work: Promise<void>): Promise<unknown> {
  return work.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function sessionFailures(failure: unknown): string[] {
  expect(failure).toBeInstanceOf(AggregateError);
  return (failure as AggregateError).errors.map((reason: Error) => {
    expect(reason.cause).toBeDefined();
    return reason.message;
  });
}

describe('closing an established MCP session whose DELETE is never answered', () => {
  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
    );
  });

  it('cancels the DELETE when the close deadline expires and reports it with the session id', async () => {
    const server = await startHeldDeleteServer();
    const client = await connectClient(server.url);
    const startedAt = Date.now();

    const failure = await failureOf(
      closeClientWithTimeout(client, 'probe', 300),
    );

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    await server.deleteReceived;
    await server.deleteAborted;
    const messages = sessionFailures(failure);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('held-delete-session');
    expect(server.liveSockets()).toBe(0);
  });

  it('cancels the DELETE when the owner signal aborts during the close and reports it once', async () => {
    const server = await startHeldDeleteServer();
    const owner = new AbortController();
    const client = await connectClient(server.url, owner.signal);

    const closing = failureOf(client.close());
    await server.deleteReceived;
    owner.abort(new Error('owner retired'));
    const failure = await closing;

    await server.deleteAborted;
    const messages = sessionFailures(failure);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('held-delete-session');
    expect(server.liveSockets()).toBe(0);
  });
});
