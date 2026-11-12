/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { createTestOwnedFetch } from '@vybestack/llxprt-code-test-utils/network/test-utils/owned-fetch.js';
import { connectToMcpServer } from './mcp-connection.js';
import {
  bindMcpOAuthCapabilities,
  McpOAuthOperations,
} from './mcp-oauth-helpers.js';
import { createTestOAuthBinding } from './test-support/oauth.js';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected TCP');
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function forwardBody(
  body: ReadableStream<Uint8Array> | null,
  response: ServerResponse,
): Promise<void> {
  if (body === null) return;
  const reader = body.getReader();
  response.on('close', () => {
    void reader.cancel();
  });
  let next = await reader.read();
  while (next.done !== true) {
    response.write(next.value);
    next = await reader.read();
  }
}

describe('MCP SSE owner proxy', () => {
  for (const mode of ['sse', 'fallback', 'authenticated-sse'] as const) {
    it(`routes ${mode} initialization and SSE messages through the owner proxy`, async () => {
      const requests: Array<{
        method: string;
        path: string;
        body: string;
        authorization: string | undefined;
      }> = [];
      let stream: ServerResponse | undefined;
      const server = createServer((request, response) => {
        void (async () => {
          if (request.method === 'GET') {
            stream = response;
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.write('event: endpoint\ndata: /messages\n\n');
            return;
          }
          if (request.url !== '/messages') {
            response.writeHead(400).end('Use SSE');
            return;
          }
          let body = '';
          for await (const chunk of request) body += chunk.toString();
          const message: unknown = JSON.parse(body);
          if (typeof message !== 'object' || message === null)
            throw new Error('Expected message');
          if ('id' in message) {
            stream?.write(
              `event: message\ndata: ${JSON.stringify({
                jsonrpc: '2.0',
                id: message.id,
                result: {
                  protocolVersion: '2025-06-18',
                  capabilities: {},
                  serverInfo: { name: 'sse-fixture', version: '1' },
                },
              })}\n\n`,
            );
          }
          response.writeHead(202).end();
        })();
      });
      const port = await listen(server);
      const sockets = new Set<Duplex>();
      const recorder = createServer((request, response) => {
        void (async () => {
          let body = '';
          for await (const chunk of request) body += chunk.toString();
          requests.push({
            method: request.method ?? '',
            path: request.url ?? '',
            body,
            authorization: request.headers.authorization,
          });
          const upstream = await fetch(
            `http://127.0.0.1:${port}${request.url}`,
            {
              method: request.method,
              headers: Object.fromEntries(
                Object.entries(request.headers).flatMap(([name, value]) =>
                  value === undefined
                    ? []
                    : [[name, Array.isArray(value) ? value.join(', ') : value]],
                ),
              ),
              ...(body ? { body } : {}),
            },
          );
          response.writeHead(
            upstream.status,
            Object.fromEntries(upstream.headers),
          );
          await forwardBody(upstream.body, response);
          response.end();
        })();
      });
      const recorderPort = await listen(recorder);
      const proxy = createServer();
      proxy.on('connect', (_request, socket, head) => {
        const upstream = connect(recorderPort, '127.0.0.1');
        sockets.add(upstream);
        sockets.add(socket);
        upstream.on('connect', () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length > 0) upstream.write(head);
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        upstream.on('error', () => socket.destroy());
        socket.on('error', () => upstream.destroy());
        socket.on('close', () => upstream.destroy());
      });
      const network = createTestOwnedFetch(
        `http://127.0.0.1:${await listen(proxy)}`,
      );
      const binding = createTestOAuthBinding();
      if (mode === 'authenticated-sse') {
        await binding.tokenStorage.saveToken(
          'local',
          { accessToken: 'local-token', tokenType: 'Bearer' },
          'local-client',
        );
      }
      const owner = new McpOAuthOperations(
        bindMcpOAuthCapabilities(network.fetch, binding),
      );
      try {
        const client = await connectToMcpServer(
          network.fetch,
          '1',
          'local',
          {
            url: `http://127.0.0.1:${port}/sse`,
            ...(mode === 'fallback' ? {} : { type: 'sse' }),
            timeout: 5000,
          },
          false,
          { getDirectories: () => [], onDirectoriesChanged: () => () => {} },
          owner,
        );
        try {
          expect(
            requests.some(
              (request) => request.method === 'GET' && request.path === '/sse',
            ),
          ).toBe(true);
          expect(
            requests.filter(
              (request) =>
                request.method === 'POST' &&
                request.body.includes('"method":"initialize"'),
            ),
          ).toHaveLength(mode === 'fallback' ? 2 : 1);
          expect(
            requests.map((request) => request.authorization),
          ).toStrictEqual(
            requests.map(() =>
              mode === 'authenticated-sse' ? 'Bearer local-token' : undefined,
            ),
          );
        } finally {
          await client.close();
        }
      } finally {
        await owner.cancelAndJoin();
        await network.dispose();
        for (const socket of sockets) socket.destroy();
        await close(proxy);
        await close(recorder);
        await close(server);
      }
    });
  }
});
