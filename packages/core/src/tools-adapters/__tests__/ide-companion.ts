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
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  PingRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export function deferred(): { promise: Promise<void>; resolve(): void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

interface Session {
  readonly server: Server;
  readonly transport: StreamableHTTPServerTransport;
  readonly streamClosed: ReturnType<typeof deferred>;
}

export class IdeCompanion {
  readonly sessions: Session[] = [];
  readonly requests: Array<{
    name: string;
    arguments: Record<string, unknown> | undefined;
  }> = [];
  readonly diffOpened = deferred();
  readonly closeEntered = deferred();
  readonly releaseClose = deferred();
  readonly releaseOpen = deferred();
  private readonly byId = new Map<string, Session>();
  private readonly responses = new Set<ServerResponse>();
  private readonly http = createServer((request, response) =>
    this.handleRequest(request, response),
  );
  private readonly contents = new Map<string, string | undefined>();
  private readonly openings = new Map<string, ReturnType<typeof deferred>>();
  port = 0;

  opened(filePath: string): Promise<void> {
    let opened = this.openings.get(filePath);
    if (opened === undefined) {
      opened = deferred();
      this.openings.set(filePath, opened);
    }
    return opened.promise;
  }

  constructor(
    private readonly holdClose = false,
    private readonly holdOpen = false,
  ) {}

  private createSession(): Session {
    const server = new Server(
      { name: 'core-diff-companion', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id) => {
        this.byId.set(id, session);
      },
    });
    const session = { server, transport, streamClosed: deferred() };
    this.sessions.push(session);
    server.setRequestHandler(PingRequestSchema, async (_request, extra) => {
      await transport.send(
        {
          jsonrpc: '2.0',
          method: 'ide/contextUpdate',
          params: { workspaceState: { isTrusted: true } },
        },
        { relatedRequestId: extra.requestId },
      );
      return {};
    });
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      const args = call.params.arguments;
      this.requests.push({ name: call.params.name, arguments: args });
      const path = args?.filePath;
      if (typeof path !== 'string') throw new Error('Missing diff file path');
      if (call.params.name === 'openDiff') {
        const content = args?.newContent;
        if (content !== undefined && typeof content !== 'string')
          throw new Error('Invalid diff content');
        this.contents.set(path, content);
        void this.opened(path);
        this.openings.get(path)?.resolve();
        this.diffOpened.resolve();
        if (this.holdOpen) await this.releaseOpen.promise;
      }
      if (call.params.name === 'closeDiff') {
        this.closeEntered.resolve();
        if (this.holdClose) await this.releaseClose.promise;
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              content: this.contents.get(path)?.replace('draft', 'edited'),
            }),
          },
        ],
      };
    });
    return session;
  }

  private handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    this.responses.add(response);
    response.once('close', () => this.responses.delete(response));
    const id = request.headers['mcp-session-id'];
    const existing = typeof id === 'string' ? this.byId.get(id) : undefined;
    const session =
      existing ??
      (request.method === 'POST' ? this.createSession() : undefined);
    if (session === undefined) {
      response.writeHead(404).end();
      return;
    }
    const connected =
      existing === undefined
        ? session.server.connect(session.transport)
        : Promise.resolve();
    if (request.method === 'GET')
      request.socket.once('close', session.streamClosed.resolve);
    void connected
      .then(() => session.transport.handleRequest(request, response))
      .catch((error: unknown) => {
        response.destroy(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(0, '127.0.0.1', resolve);
    });
    const address = this.http.address();
    if (address === null || typeof address === 'string')
      throw new Error('Companion did not bind a port');
    this.port = address.port;
  }

  decide(
    index: number,
    filePath: string,
    outcome: 'accepted' | 'rejected',
  ): Promise<void> {
    return this.sessions[index].transport.send({
      jsonrpc: '2.0',
      method: outcome === 'accepted' ? 'ide/diffAccepted' : 'ide/diffRejected',
      params:
        outcome === 'accepted'
          ? {
              filePath,
              content:
                this.contents.get(filePath)?.replace('draft', 'edited') ?? '',
            }
          : { filePath },
    });
  }

  async close(): Promise<void> {
    this.releaseClose.resolve();
    this.releaseOpen.resolve();
    await Promise.all(this.sessions.map((session) => session.server.close()));
    for (const response of this.responses) response.destroy();
    const stopped = new Promise<void>((resolve, reject) =>
      this.http.close((error) => (error ? reject(error) : resolve())),
    );
    this.http.closeAllConnections();
    await stopped;
  }
}
