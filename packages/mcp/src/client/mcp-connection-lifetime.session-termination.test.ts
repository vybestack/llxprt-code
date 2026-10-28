/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createJoiningTransport } from './mcp-connection-lifetime.js';

interface SessionServer {
  readonly url: URL;
  readonly deletes: string[];
}

const servers: Server[] = [];

async function startSessionServer(
  deleteStatus: number,
): Promise<SessionServer> {
  const deletes: string[] = [];
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      if (request.method === 'DELETE') {
        deletes.push(String(request.headers['mcp-session-id']));
        response.writeHead(deleteStatus).end();
        return;
      }
      response
        .writeHead(200, {
          'content-type': 'application/json',
          'mcp-session-id': 'session-under-test',
        })
        .end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { protocolVersion: '2025-06-18', capabilities: {} },
          }),
        );
    });
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
    deletes,
  };
}

async function openSession(url: URL): Promise<StreamableHTTPClientTransport> {
  const transport = createJoiningTransport(
    (fetch) => new StreamableHTTPClientTransport(url, { fetch }),
  );
  await transport.start();
  await transport.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'session-termination-test', version: '0' },
    },
  });
  return transport;
}

describe('createJoiningTransport session termination', () => {
  afterEach(async () => {
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

  it('sends a session DELETE before the transport closes', async () => {
    const server = await startSessionServer(200);
    const transport = await openSession(server.url);
    expect(transport.sessionId).toBe('session-under-test');

    await transport.close();

    expect(server.deletes).toStrictEqual(['session-under-test']);
  });

  it('treats a server that refuses session termination (405) as closed', async () => {
    const server = await startSessionServer(405);
    const transport = await openSession(server.url);

    await transport.close();

    expect(server.deletes).toStrictEqual(['session-under-test']);
  });

  it('reports a failed session DELETE with the session id after the transport has closed', async () => {
    const server = await startSessionServer(500);
    const transport = await openSession(server.url);

    const failure: unknown = await transport.close().then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    const reasons = (failure as AggregateError).errors as Error[];
    expect(reasons).toHaveLength(1);
    expect(reasons[0].message).toContain('session-under-test');
    expect(server.deletes).toStrictEqual(['session-under-test']);
    await expect(
      transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ).rejects.toThrow('MCP transport is closed');
  });

  it('sends no DELETE when no session was established', async () => {
    const server = await startSessionServer(200);
    const transport = createJoiningTransport(
      (fetch) => new StreamableHTTPClientTransport(server.url, { fetch }),
    );
    await transport.start();

    await transport.close();

    expect(server.deletes).toStrictEqual([]);
  });
});
