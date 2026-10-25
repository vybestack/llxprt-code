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
import type { Socket } from 'node:net';
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

export interface NoAuthMcpFixture {
  readonly base: string;
  readonly events: string[];
  liveSessions(): number;
  liveSockets(): number;
  hold(method: string): void;
  waitUntilHeld(method: string): Promise<void>;
  release(method: string): void;
  /** Withholds the response to every session DELETE until the client gives up. */
  holdSessionDeletes(): void;
  close(): Promise<void>;
}

interface HeldRequest {
  readonly respond: () => void;
}

function readSessionResult(method: string): unknown {
  if (method === 'initialize')
    return {
      protocolVersion: '2024-11-05',
      capabilities: { resources: {} },
      serverInfo: { name: 'same', version: '1' },
    };
  if (method === 'resources/list')
    return { resources: [{ uri: 'test://same', name: 'same' }] };
  if (method === 'resources/read')
    return { contents: [{ uri: 'test://same', text: 'plain' }] };
  return {};
}

async function listenOnLoopback(
  server: ReturnType<typeof createServer>,
): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing server address');
  return address.port;
}

function sendJsonRpcResult(
  response: ServerResponse,
  message: z.infer<typeof jsonRpcMessageSchema>,
  sessionId: string | undefined,
): void {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (sessionId !== undefined) headers['mcp-session-id'] = sessionId;
  response.writeHead(200, headers);
  response.end(
    JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: readSessionResult(message.method),
    }),
  );
}

interface NoAuthServerState {
  readonly events: string[];
  readonly armed: Set<string>;
  readonly held: Map<string, HeldRequest>;
  readonly waiters: Map<string, Array<() => void>>;
  readonly sessions: Set<string>;
  sessionCounter: number;
  holdDeletes: boolean;
}

function serveNoAuthRequest(
  state: NoAuthServerState,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const { events, armed, held, waiters, sessions } = state;
  response.setHeader('connection', 'close');
  let body = '';
  request.on('data', (chunk: Buffer) => {
    body += chunk.toString();
  });
  request.on('end', () => {
    if (request.method === 'DELETE') {
      const sessionId = String(request.headers['mcp-session-id']);
      events.push(`delete:${sessionId}`);
      if (state.holdDeletes) {
        response.on('close', () => {
          if (!response.writableEnded)
            events.push(`delete-abandoned:${sessionId}`);
        });
        return;
      }
      sessions.delete(sessionId);
      response.writeHead(200);
      response.end();
      return;
    }
    if (request.method !== 'POST') {
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
    events.push(`request:${message.method}`);
    const reply = (): void => {
      const sessionId =
        message.method === 'initialize'
          ? `session-${++state.sessionCounter}`
          : undefined;
      if (sessionId !== undefined) sessions.add(sessionId);
      sendJsonRpcResult(response, message, sessionId);
    };
    if (!armed.delete(message.method)) {
      reply();
      return;
    }
    events.push(`held:${message.method}`);
    held.set(message.method, { respond: reply });
    for (const wake of waiters.get(message.method) ?? []) wake();
    waiters.delete(message.method);
    response.on('close', () => {
      if (held.get(message.method)?.respond === reply) {
        held.delete(message.method);
        events.push(`abandoned:${message.method}`);
      }
    });
  });
}

/**
 * Unauthenticated streamable-HTTP MCP server. `hold(method)` withholds the
 * response to the next JSON-RPC request with that method until `release`, and a
 * held request whose socket closes is abandoned (recorded as `abandoned:<method>`),
 * so a client abort ends it. Every response closes its connection, so a socket
 * that is still open is one whose request has not been answered or abandoned.
 * It records every request, session DELETE and socket close in `events`, and
 * counts the sessions and sockets still open so a test can prove retirement
 * before the fixture's own `close` force-closes whatever remains.
 */
export async function startNoAuthMcpFixture(): Promise<NoAuthMcpFixture> {
  const state: NoAuthServerState = {
    events: [],
    armed: new Set(),
    held: new Map(),
    waiters: new Map(),
    sessions: new Set(),
    sessionCounter: 0,
    holdDeletes: false,
  };
  const { events, armed, held, waiters, sessions } = state;
  const sockets = new Set<Socket>();
  const server = createServer((request, response) =>
    serveNoAuthRequest(state, request, response),
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => {
      sockets.delete(socket);
      events.push('socket-closed');
    });
  });
  const port = await listenOnLoopback(server);
  return {
    base: `http://127.0.0.1:${port}`,
    events,
    liveSessions: () => sessions.size,
    liveSockets: () => sockets.size,
    hold: (method) => {
      armed.add(method);
    },
    waitUntilHeld: (method) =>
      held.has(method)
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.set(method, [...(waiters.get(method) ?? []), resolve]);
          }),
    holdSessionDeletes: () => {
      state.holdDeletes = true;
    },
    release: (method) => {
      const request = held.get(method);
      held.delete(method);
      events.push(`released:${method}`);
      request?.respond();
    },
    close: async () => {
      for (const method of [...held.keys()]) {
        held.get(method)?.respond();
        held.delete(method);
      }
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
