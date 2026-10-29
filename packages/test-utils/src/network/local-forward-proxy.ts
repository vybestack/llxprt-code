/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { once } from 'node:events';

export interface ForwardProxyRequest {
  readonly host: string;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface RecordedProxyRequest extends ForwardProxyRequest {
  readonly via: 'absolute' | 'connect';
  readonly closed: boolean;
}

export type ForwardProxyResponder = (
  request: ForwardProxyRequest,
) => Response | Promise<Response>;

export interface LocalForwardProxy {
  readonly url: string;
  readonly requests: readonly RecordedProxyRequest[];
  requestsTo(host: string): readonly RecordedProxyRequest[];
  hold(host: string): void;
  release(host: string): void;
  close(): Promise<void>;
}

interface Hold {
  claimed: boolean;
  readonly opened: Promise<void>;
  readonly open: () => void;
}

type TrackedRequest = {
  -readonly [K in keyof RecordedProxyRequest]: RecordedProxyRequest[K];
};

const LOOPBACK = '127.0.0.1';

function flattenHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return headers;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString();
}

function hostnameOf(hostWithPort: string): string {
  return new URL(`http://${hostWithPort}`).hostname;
}

async function listen(server: Server): Promise<number> {
  server.listen(0, LOOPBACK);
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

class ForwardProxy implements LocalForwardProxy {
  readonly requests: TrackedRequest[] = [];
  readonly #routes: ReadonlyMap<string, ForwardProxyResponder>;
  readonly #holds = new Map<string, Hold>();
  readonly #sockets = new Set<Socket>();
  readonly #proxyServer: Server;
  readonly #tunnelTargetServer: Server;
  #tunnelTargetPort = 0;
  #closing: Promise<void> | undefined;
  #url = '';

  constructor(routes: Readonly<Record<string, ForwardProxyResponder>>) {
    this.#routes = new Map(Object.entries(routes));
    this.#proxyServer = createServer((request, response) =>
      this.#handleProxyRequest(request, response),
    );
    this.#tunnelTargetServer = createServer((request, response) =>
      this.#handleTunnelledRequest(request, response),
    );
    this.#proxyServer.on('connect', (_request, socket, head) =>
      this.#openTunnel(socket as Socket, head),
    );
    for (const server of [this.#proxyServer, this.#tunnelTargetServer]) {
      server.on('connection', (socket) => this.#track(socket));
    }
  }

  get url(): string {
    return this.#url;
  }

  async start(): Promise<void> {
    this.#tunnelTargetPort = await listen(this.#tunnelTargetServer);
    this.#url = `http://${LOOPBACK}:${await listen(this.#proxyServer)}`;
  }

  requestsTo(host: string): readonly RecordedProxyRequest[] {
    return this.requests.filter((request) => request.host === host);
  }

  hold(host: string): void {
    if (this.#holds.has(host)) {
      throw new Error(`Host ${host} is already held`);
    }
    let open: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
      open = resolve;
    });
    this.#holds.set(host, { claimed: false, opened, open });
  }

  release(host: string): void {
    this.#holds.get(host)?.open();
    this.#holds.delete(host);
  }

  close(): Promise<void> {
    this.#closing ??= this.#shutDown();
    return this.#closing;
  }

  async #shutDown(): Promise<void> {
    for (const host of [...this.#holds.keys()]) {
      this.release(host);
    }
    const open = [...this.#sockets];
    const closed = open.map((socket) => once(socket, 'close'));
    for (const socket of open) {
      socket.destroy();
    }
    await Promise.all(closed);
    await Promise.all(
      [this.#proxyServer, this.#tunnelTargetServer].map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
    );
  }

  #track(socket: Socket): void {
    this.#sockets.add(socket);
    socket.once('close', () => this.#sockets.delete(socket));
  }

  #openTunnel(socket: Socket, head: Buffer): void {
    const upstream = connect(this.#tunnelTargetPort, LOOPBACK);
    this.#track(upstream);
    upstream.once('connect', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
  }

  #handleProxyRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const rawUrl = request.url ?? '';
    if (!rawUrl.startsWith('http://')) {
      response.writeHead(400).end('Forward proxy needs an absolute-form URL');
      return;
    }
    const target = new URL(rawUrl);
    this.#serve(
      'absolute',
      target.hostname,
      target.pathname + target.search,
      request,
      response,
    );
  }

  #handleTunnelledRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const hostHeader = request.headers.host;
    if (hostHeader === undefined) {
      response.writeHead(400).end('Tunnelled request has no Host header');
      return;
    }
    this.#serve(
      'connect',
      hostnameOf(hostHeader),
      request.url ?? '/',
      request,
      response,
    );
  }

  #serve(
    via: RecordedProxyRequest['via'],
    host: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    this.#respond(via, host, path, request, response).catch(
      (error: unknown) => {
        if (response.destroyed) return;
        response
          .writeHead(500)
          .end(error instanceof Error ? error.message : String(error));
      },
    );
  }

  async #respond(
    via: RecordedProxyRequest['via'],
    host: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const forwarded: ForwardProxyRequest = {
      host,
      method: request.method ?? 'GET',
      path,
      headers: flattenHeaders(request),
      body: await readBody(request),
    };
    const record: TrackedRequest = { ...forwarded, via, closed: false };
    request.socket.once('close', () => {
      record.closed = true;
    });
    this.requests.push(record);

    const held = this.#holds.get(host);
    if (held !== undefined && !held.claimed) {
      held.claimed = true;
      await held.opened;
    }

    const route = this.#routes.get(host);
    const reply =
      route === undefined
        ? new Response(`No route for ${host}`, { status: 502 })
        : await route(forwarded);
    const bytes = Buffer.from(await reply.arrayBuffer());
    if (response.destroyed) return;
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(bytes);
  }
}

export async function startLocalForwardProxy(
  routes: Readonly<Record<string, ForwardProxyResponder>>,
): Promise<LocalForwardProxy> {
  const proxy = new ForwardProxy(routes);
  await proxy.start();
  return proxy;
}
