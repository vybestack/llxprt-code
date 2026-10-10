/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createTestOAuthBinding } from './test-support/index.js';

import { unsupportedApprovalPolicy } from './test-support/approval-policy.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { json } from 'node:stream/consumers';
import { z } from 'zod';
import {
  buildToolGovernance,
  ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import { McpClient, MCPServerStatus } from './mcp-client.js';
import {
  PromptRegistry,
  ResourceRegistry,
  WorkspaceContext,
} from './test-support/mcpClientTestSupport.js';
import { MCPOAuthTokenStorage } from '../auth/index.js';
import type {
  OAuthCredentials,
  TokenStorage,
} from '../auth/token-storage/index.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function observe(promise: Promise<unknown>): {
  result: Promise<unknown>;
  settled: () => boolean;
} {
  let settled = false;
  return {
    result: promise.then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    ),
    settled: () => settled,
  };
}
class MemoryStore implements TokenStorage {
  credentials: OAuthCredentials = {
    serverName: 'same',
    clientId: 'client',
    tokenUrl: 'https://auth.invalid/token',
    token: {
      accessToken: 'old',
      refreshToken: 'refresh',
      tokenType: 'Bearer',
      expiresAt: 1,
    },
    updatedAt: 1,
  };
  deletes = 0;
  writes = 0;
  async getCredentials(): Promise<OAuthCredentials> {
    return this.credentials;
  }
  async setCredentials(value: OAuthCredentials): Promise<void> {
    this.writes++;
    this.credentials = value;
  }
  async deleteCredentials(): Promise<void> {
    this.deletes++;
  }
  async listServers(): Promise<string[]> {
    return ['same'];
  }
  async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
    return new Map([['same', this.credentials]]);
  }
  async clearAll(): Promise<void> {}
}
const network: {
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
} = globalThis;
const nativeFetch = globalThis.fetch;

function createClient(
  store: MemoryStore,
  url: string,
  timeout = 10000,
  type: 'http' | 'sse' = 'http',
): { client: McpClient; tools: ToolRegistry } {
  const tools = new ToolRegistry(
    {},
    { requestConfirmation: async () => false },
    () => ({
      hideTaskAsync: false,
      lazyMcp: false,
      eagerServers: [],
      governance: buildToolGovernance({
        getEphemeralSettings: () => ({}),
        getExcludeTools: () => [],
      }),
    }),
  );
  return {
    tools,
    client: new McpClient(
      {
        ...createTestOAuthBinding(),
        tokenStorage: new MCPOAuthTokenStorage(store),
      },
      unsupportedApprovalPolicy(),
      'same',
      {
        url,
        type,
        timeout,
        oauth: { enabled: true, clientId: 'client' },
      },
      tools,
      new PromptRegistry(),
      new ResourceRegistry(),
      new WorkspaceContext(process.cwd()),
      { isTrustedFolder: () => true },
      false,
      'test',
    ),
  };
}

describe('actual MCP client auth cancellation', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['fetch', 'body'])(
    'joins cancelled SSE %s work without waiting for an endpoint event',
    async (phase) => {
      store.credentials = {
        ...store.credentials,
        token: { ...store.credentials.token, expiresAt: Date.now() + 3600000 },
      };
      const entered = deferred<void>();
      const release = deferred<void>();
      let requests = 0;
      vi.spyOn(network, 'fetch').mockImplementation(async () => {
        requests++;
        if (phase === 'fetch') {
          entered.resolve();
          await release.promise;
        }
        return new Response(
          new ReadableStream<Uint8Array>(
            {
              async pull(stream) {
                entered.resolve();
                await release.promise;
                stream.enqueue(new TextEncoder().encode(': alive\n\n'));
                stream.close();
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      });
      const { client } = createClient(
        store,
        'https://same.invalid/sse',
        10000,
        'sse',
      );
      const connecting = observe(client.connect());
      try {
        await entered.promise;
        const stopping = observe(client.disconnect());
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(stopping.settled()).toBe(false);
        release.resolve();
        await stopping.result;
        await connecting.result;
        expect(client.getStatus()).toBe(MCPServerStatus.DISCONNECTED);
        expect(requests).toBe(1);
      } finally {
        release.resolve();
      }
    },
  );

  it.each(
    ['refresh', 'handshake', 'body'].flatMap((phase) =>
      ['disconnect', 'timeout'].map((mode) => ({ phase, mode })),
    ),
  )(
    '$mode aborts immediately and joins ignoring $phase without affecting identical B',
    async ({ phase, mode }) => {
      if (phase !== 'refresh')
        store.credentials = {
          ...store.credentials,
          token: {
            ...store.credentials.token,
            expiresAt: Date.now() + 3600000,
          },
        };
      let handshakes = 0;
      const server = createServer((request, response) => {
        if (request.method !== 'POST') {
          response.writeHead(405).end();
          return;
        }
        void json(request)
          .then((value: unknown) => {
            const body = z
              .object({
                id: z.union([z.string(), z.number()]).optional(),
                method: z.string(),
              })
              .parse(value);
            if (body.id === undefined) {
              response.writeHead(202).end();
              return;
            }
            handshakes++;
            response.writeHead(200, { 'content-type': 'application/json' }).end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: {
                  protocolVersion: '2025-03-26',
                  capabilities: {},
                  serverInfo: { name: 'loopback', version: '1' },
                  instructions: 'still connected',
                },
              }),
            );
          })
          .catch((cause: unknown) => {
            response.destroy(
              new Error('Invalid loopback MCP request', { cause }),
            );
          });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('Expected loopback TCP server address');
      }
      const serverUrl = `http://127.0.0.1:${address.port}/`;
      const entered = deferred<void>();
      const aborted = deferred<void>();
      const release = deferred<void>();
      let refreshes = 0;
      let firstHandshake = true;
      vi.spyOn(network, 'fetch').mockImplementation(async (input, init) => {
        if (String(input).startsWith('https://auth.invalid/')) {
          refreshes++;
          if (refreshes === 1) {
            init?.signal?.addEventListener('abort', () => aborted.resolve(), {
              once: true,
            });
            entered.resolve();
            await release.promise;
          }
          return Response.json({
            access_token: 'rotated',
            token_type: 'Bearer',
            expires_in: 3600,
          });
        }
        if (phase !== 'refresh' && firstHandshake && init?.method === 'POST') {
          firstHandshake = false;
          init.signal?.addEventListener('abort', () => aborted.resolve(), {
            once: true,
          });
          const response = await nativeFetch(input, init);
          if (phase === 'handshake') {
            entered.resolve();
            await release.promise;
            return response;
          }
          const text = await response.text();
          return new Response(
            new ReadableStream<Uint8Array>(
              {
                async pull(stream) {
                  entered.resolve();
                  await release.promise;
                  stream.enqueue(new TextEncoder().encode(text));
                  stream.close();
                },
              },
              { highWaterMark: 0 },
            ),
            { headers: response.headers },
          );
        }
        return nativeFetch(input, init);
      });
      const a = createClient(store, serverUrl, mode === 'timeout' ? 30 : 10000);
      const b = createClient(store, serverUrl);
      const connecting = observe(a.client.connect());
      try {
        await entered.promise;
        const stopping =
          mode === 'disconnect' ? observe(a.client.disconnect()) : connecting;
        await aborted.promise;
        await b.client.connect();
        expect(stopping.settled()).toBe(false);
        expect(connecting.settled()).toBe(false);
        expect(b.client.getStatus()).toBe(MCPServerStatus.CONNECTED);
        expect(b.client.getInstructions()).toBe('still connected');
        release.resolve();
        await stopping.result;
        const result = await connecting.result;
        expect(result instanceof Error ? result.message : result).toBe(
          mode === 'timeout'
            ? 'MCP error -32001: Request timed out'
            : undefined,
        );
        expect(a.client.getStatus()).toBe(MCPServerStatus.DISCONNECTED);
        expect(a.tools.getAllTools()).toStrictEqual([]);
        expect(handshakes).toBe(phase === 'refresh' ? 1 : 2);
        expect(store.deletes).toBe(0);
        expect(store.writes).toBe(phase === 'refresh' ? 1 : 0);
        expect(store.credentials.token.accessToken).toBe(
          phase === 'refresh' ? 'rotated' : 'old',
        );
      } finally {
        release.resolve();
        await Promise.all([
          a.client.disconnect(),
          b.client.disconnect(),
          connecting.result,
        ]);
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  );
});
