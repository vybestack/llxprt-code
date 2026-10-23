/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  PingRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  IdeClient,
  type IdeContext,
} from '@vybestack/llxprt-code-ide-integration';

export function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

interface Session {
  readonly transport: StreamableHTTPServerTransport;
  readonly server: Server;
  readonly trusted: boolean;
  readonly streamClosed: ReturnType<typeof deferred>;
  initialContext?: Promise<void>;
}

class Companion {
  readonly sessions: Session[] = [];
  readonly pingEntered = deferred();
  readonly releasePing = deferred();
  readonly diffOpened = deferred();
  readonly closeDiffEntered = deferred();
  readonly releaseCloseDiff = deferred();
  private readonly byId = new Map<string, Session>();
  private readonly responses = new Set<ServerResponse>();
  private readonly http = createServer((request, response) =>
    this.handleRequest(request, response),
  );
  port = 0;

  constructor(
    private readonly blockPing: boolean,
    private readonly blockCloseDiff: boolean,
  ) {}

  private createSession(): Session {
    const server = new Server(
      { name: 'independent-ide-companion', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (sessionId) => {
        this.byId.set(sessionId, owned);
      },
    });
    const owned: Session = {
      transport,
      server,
      trusted: this.sessions.length % 2 === 0,
      streamClosed: deferred(),
    };
    this.sessions.push(owned);
    server.setRequestHandler(PingRequestSchema, async (_request, extra) => {
      this.pingEntered.resolve();
      if (this.blockPing) await this.releasePing.promise;
      // Use the companion's authoritative ping path for fixture bootstrap.
      // Opening the subscription stream must not replay a completed handshake.
      owned.initialContext ??= transport.send(
        {
          jsonrpc: '2.0',
          method: 'ide/contextUpdate',
          params: { workspaceState: { isTrusted: owned.trusted } },
        },
        { relatedRequestId: extra.requestId },
      );
      await owned.initialContext;
      return {};
    });
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      if (call.params.name === 'openDiff') this.diffOpened.resolve();
      if (call.params.name === 'closeDiff') {
        this.closeDiffEntered.resolve();
        if (this.blockCloseDiff) await this.releaseCloseDiff.promise;
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ content: 'peer remains usable' }),
          },
        ],
      };
    });
    return owned;
  }

  private handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    this.responses.add(response);
    response.once('close', () => this.responses.delete(response));
    const id = request.headers['mcp-session-id'];
    let session = typeof id === 'string' ? this.byId.get(id) : undefined;
    if (session === undefined && request.method === 'POST') {
      session = this.createSession();
      const owned = session;
      void owned.server
        .connect(owned.transport)
        .then(() => owned.transport.handleRequest(request, response))
        .catch((error: unknown) =>
          response.destroy(
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
      return;
    }
    if (session === undefined) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'GET')
      request.socket.once('close', session.streamClosed.resolve);
    const active = session;
    void active.transport
      .handleRequest(request, response)
      .catch((error: unknown) =>
        response.destroy(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(0, '127.0.0.1', resolve);
    });
    const address = this.http.address();
    if (address === null || typeof address === 'string')
      throw new Error('Companion did not bind a TCP port');
    this.port = address.port;
  }

  updateTrust(index: number, trusted: boolean | undefined): Promise<void> {
    return this.updateContext(index, {
      workspaceState: { isTrusted: trusted },
    });
  }

  updateContext(index: number, context: IdeContext): Promise<void> {
    return this.sessions[index].transport.send({
      jsonrpc: '2.0',
      method: 'ide/contextUpdate',
      params: context,
    });
  }

  async close(): Promise<void> {
    this.releasePing.resolve();
    this.releaseCloseDiff.resolve();
    await Promise.all(this.sessions.map((session) => session.server.close()));
    for (const response of this.responses) response.destroy();
    const stopped = new Promise<void>((resolve, reject) =>
      this.http.close((error) => (error ? reject(error) : resolve())),
    );
    this.http.closeAllConnections();
    await stopped;
  }
}

const environment = new Map<string, string | undefined>();
export const cleanup: Array<() => Promise<void>> = [];
function setEnvironment(name: string, value: string): void {
  if (!environment.has(name)) environment.set(name, process.env[name]);
  process.env[name] = value;
}
export async function setup(
  blockPing = false,
  blockCloseDiff = false,
): Promise<Companion> {
  const host = new Companion(blockPing, blockCloseDiff);
  await host.start();
  cleanup.push(() => host.close());
  setEnvironment('TERM_PROGRAM', 'vscode');
  setEnvironment('LLXPRT_CODE_IDE_SERVER_PORT', String(host.port));
  setEnvironment('LLXPRT_CODE_IDE_WORKSPACE_PATH', process.cwd());
  return host;
}
export async function client(): Promise<IdeClient> {
  const instance = await IdeClient.create();
  cleanup.push(() => instance.disconnect());
  return instance;
}
export function installIdeCleanup(): void {
  afterEach(async (): Promise<void> => {
    for (const dispose of cleanup.reverse()) await dispose();
    cleanup.length = 0;
    for (const [name, value] of environment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    environment.clear();
  });
}
