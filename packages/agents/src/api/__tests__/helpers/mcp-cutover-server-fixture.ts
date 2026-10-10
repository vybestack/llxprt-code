/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export interface CutoverFixtureServer {
  readonly server: ReturnType<typeof createServer>;
  base: string;
  readonly traffic: string[];
}

interface FixtureState {
  readonly streams: Map<string, ServerResponse>;
  readonly authorization: Map<string, URL>;
  readonly traffic: string[];
  readonly sessionCounter: () => number;
  readonly transportType: 'http' | 'sse';
  registrations: number;
}

const jsonRpcMessageSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
});

function sendJson(
  response: ServerResponse,
  url: URL,
  value: unknown,
  state: FixtureState,
): void {
  const sessionId = url.searchParams.get('session');
  if (sessionId !== null) {
    const stream = state.streams.get(sessionId);
    if (!stream) throw new Error('Missing SSE session');
    stream.write(`event: message\ndata: ${JSON.stringify(value)}\n\n`);
    response.writeHead(202);
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function openSseStream(response: ServerResponse, state: FixtureState): void {
  const sessionId = String(state.sessionCounter());
  state.streams.set(sessionId, response);
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
  });
  response.write(`event: endpoint\ndata: /messages?session=${sessionId}\n\n`);
  response.on('close', () => state.streams.delete(sessionId));
}

function handleAuthorization(
  url: URL,
  response: ServerResponse,
  state: FixtureState,
): void {
  const owner = url.searchParams.get('owner') ?? '';
  state.authorization.set(owner, url);
  const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
  callback.searchParams.set('state', url.searchParams.get('state') ?? '');
  callback.searchParams.set('code', owner);
  response.writeHead(302, { location: callback.toString() });
  response.end();
}

function handleToken(
  body: string,
  url: URL,
  response: ServerResponse,
  state: FixtureState,
): void {
  const form = new URLSearchParams(body);
  const code = form.get('code');
  if (code) {
    const original = state.authorization.get(code);
    const challenge = createHash('sha256')
      .update(form.get('code_verifier') ?? '')
      .digest('base64url');
    if (
      original?.searchParams.get('code_challenge') !== challenge ||
      original.searchParams.get('redirect_uri') !== form.get('redirect_uri') ||
      original.searchParams.get('client_id') !== form.get('client_id')
    ) {
      response.writeHead(400);
      response.end('invalid PKCE/client/redirect');
      return;
    }
  }
  const token = code ?? `${form.get('refresh_token')}-rotated`;
  sendJson(
    response,
    url,
    {
      access_token: token,
      refresh_token: code ?? form.get('refresh_token'),
      token_type: 'Bearer',
      expires_in: 3600,
    },
    state,
  );
}

function handleMcp(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  body: string,
  state: FixtureState,
): void {
  const token = request.headers.authorization;
  if (!token) {
    response.writeHead(401, { 'www-authenticate': 'Bearer' });
    response.end();
    return;
  }
  state.traffic.push(token);
  if (request.method === 'DELETE') {
    response.writeHead(200);
    response.end();
    return;
  }
  if (request.method === 'GET') {
    if (state.transportType === 'sse') {
      openSseStream(response, state);
      return;
    }
    response.writeHead(405);
    response.end();
    return;
  }
  const message = jsonRpcMessageSchema.parse(JSON.parse(body));
  if (message.id === undefined) {
    response.writeHead(202);
    response.end();
    return;
  }
  let result: unknown = {};
  if (message.method === 'initialize')
    result = {
      protocolVersion: '2024-11-05',
      capabilities: { resources: {} },
      serverInfo: { name: 'same', version: '1' },
    };
  else if (message.method === 'resources/list')
    result = { resources: [{ uri: 'test://same', name: 'same' }] };
  else if (message.method === 'resources/read')
    result = { contents: [{ uri: 'test://same', text: token }] };
  sendJson(response, url, { jsonrpc: '2.0', id: message.id, result }, state);
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  body: string,
  state: FixtureState,
): void {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/register') {
    state.registrations++;
    sendJson(
      response,
      url,
      { client_id: `client-${state.registrations}` },
      state,
    );
    return;
  }
  if (url.pathname === '/authorize') {
    handleAuthorization(url, response, state);
    return;
  }
  if (url.pathname === '/token') {
    handleToken(body, url, response, state);
    return;
  }
  if (url.pathname !== '/mcp' && url.pathname !== '/messages') {
    response.writeHead(404);
    response.end();
    return;
  }
  handleMcp(request, response, url, body, state);
}

export function startCutoverFixtureServer(
  transportType: 'http' | 'sse',
  sessionCounter: () => number,
): CutoverFixtureServer {
  const state: FixtureState = {
    streams: new Map(),
    authorization: new Map(),
    traffic: [],
    registrations: 0,
    transportType,
    sessionCounter,
  };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => handleRequest(request, response, body, state));
  });
  return { server, base: '', traffic: state.traffic };
}

export function listenCutoverFixtureServer(
  fixture: CutoverFixtureServer,
): Promise<void> {
  return new Promise<void>((resolve) => {
    fixture.server.listen(0, '127.0.0.1', () => {
      const address = fixture.server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Missing server address');
      }
      fixture.base = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}
