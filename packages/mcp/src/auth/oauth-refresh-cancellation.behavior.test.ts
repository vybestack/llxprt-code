/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as http from 'node:http';
import { MCPOAuthProvider } from './oauth-provider.js';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';
import type { OAuthCredentials, TokenStorage } from './token-storage/index.js';

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
async function turn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
const config = {
  clientId: 'client',
  clientSecret: 'secret',
  scopes: ['read'],
  audiences: ['api'],
};
const original: OAuthCredentials = {
  serverName: 'shared',
  clientId: config.clientId,
  tokenUrl: 'https://auth.invalid/token',
  mcpServerUrl: 'https://mcp.invalid/',
  token: {
    accessToken: 'original',
    refreshToken: 'refresh-original',
    tokenType: 'Bearer',
    scope: 'read',
    expiresAt: 1,
  },
  updatedAt: 1,
};
const network: {
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
} = globalThis;
const nativeFetch = globalThis.fetch;
const rotated = {
  access_token: 'rotated',
  refresh_token: 'refresh-rotated',
  token_type: 'Bearer',
  expires_in: 3600,
};

class MemoryStore implements TokenStorage {
  credentials: OAuthCredentials | null = original;
  reads = 0;
  writes = 0;
  deletes = 0;
  beforeRead: () => Promise<void> = async () => {};
  beforeWrite: () => Promise<void> = async () => {};
  beforeDelete: () => Promise<void> = async () => {};
  async getCredentials(): Promise<OAuthCredentials | null> {
    this.reads++;
    await this.beforeRead();
    return this.credentials;
  }
  async setCredentials(value: OAuthCredentials): Promise<void> {
    this.writes++;
    await this.beforeWrite();
    this.credentials = value;
  }
  async deleteCredentials(): Promise<void> {
    this.deletes++;
    await this.beforeDelete();
    this.credentials = null;
  }
  async listServers(): Promise<string[]> {
    return this.credentials ? [this.credentials.serverName] : [];
  }
  async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
    return new Map(
      this.credentials ? [[this.credentials.serverName, this.credentials]] : [],
    );
  }
  async clearAll(): Promise<void> {
    this.credentials = null;
  }
}

describe('MCP refresh and token cancellation', () => {
  let store: MemoryStore;
  let tokenStorage: MCPOAuthTokenStorage;
  beforeEach(() => {
    store = new MemoryStore();
    tokenStorage = new MCPOAuthTokenStorage(store);
    vi.spyOn(network, 'fetch').mockImplementation(async () =>
      Response.json(rotated),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const method of ['refresh', 'read'] as const) {
    it(`rejects pre-aborted ${method} without external effects`, async () => {
      const controller = new AbortController();
      const reason = { cancelled: method };
      controller.abort(reason);
      let requests = 0;
      vi.spyOn(network, 'fetch').mockImplementation(async () => {
        requests++;
        return Response.json(rotated);
      });
      const work =
        method === 'refresh'
          ? MCPOAuthProvider.refreshAccessToken(
              config,
              'refresh',
              original.tokenUrl!,
              undefined,
              controller.signal,
            )
          : MCPOAuthProvider.getValidToken(
              tokenStorage,
              'shared',
              config,
              controller.signal,
            );
      expect(await observe(work).result).toBe(reason);
      expect([
        requests,
        store.reads,
        store.writes,
        store.deletes,
      ]).toStrictEqual([0, 0, 0, 0]);
    });
  }

  for (const phase of [
    'read',
    'refresh',
    'body',
    'error-body',
    'write',
    'delete',
  ] as const) {
    for (const rejects of [false, true]) {
      it(`joins ${phase} ${rejects ? 'rejection' : 'completion'} after cancellation`, async () => {
        const entered = deferred<void>();
        const release = deferred<void>();
        const controller = new AbortController();
        const reason = { cancelled: phase };
        const externalError = new Error(`external ${phase}`);
        const barrier = async (): Promise<void> => {
          entered.resolve();
          await release.promise;
          if (rejects) throw externalError;
        };
        let receivedSignal: AbortSignal | null | undefined;
        if (phase === 'read') store.beforeRead = barrier;
        if (phase === 'write') store.beforeWrite = barrier;
        if (phase === 'delete') store.beforeDelete = barrier;
        vi.spyOn(network, 'fetch').mockImplementation(async (_input, init) => {
          receivedSignal = init?.signal;
          if (phase === 'refresh') await barrier();
          if (phase === 'body' || phase === 'error-body') {
            return new Response(
              new ReadableStream<Uint8Array>(
                {
                  async pull(stream): Promise<void> {
                    await barrier();
                    stream.enqueue(
                      new TextEncoder().encode(JSON.stringify(rotated)),
                    );
                    stream.close();
                  },
                },
                { highWaterMark: 0 },
              ),
              {
                status: phase === 'error-body' ? 400 : 200,
                headers: { 'content-type': 'application/json' },
              },
            );
          }
          return phase === 'delete'
            ? Response.json({ error: 'invalid_grant' }, { status: 400 })
            : Response.json(rotated);
        });
        const work = observe(
          MCPOAuthProvider.getValidToken(
            tokenStorage,
            'shared',
            config,
            controller.signal,
          ),
        );
        await entered.promise;
        controller.abort(reason);
        await turn();
        const pending = !work.settled();
        release.resolve();
        expect(await work.result).toBe(reason);
        expect(pending).toBe(true);
        expect(receivedSignal).toBe(
          phase === 'read' ? undefined : controller.signal,
        );
        expect(store.deletes).toBe(phase === 'delete' ? 1 : 0);
        expect(store.writes).toBe(phase === 'write' ? 1 : 0);
        let expectedToken: string | undefined = 'original';
        if (!rejects && phase === 'write') expectedToken = 'rotated';
        if (!rejects && phase === 'delete') expectedToken = undefined;
        expect(store.credentials?.token.accessToken).toBe(expectedToken);
      });
    }
  }

  for (const phase of ['fetch', 'body', 'read', 'delete'] as const) {
    it(`retains non-abort ${phase} failure identity with a live signal`, async () => {
      const failure = new Error(`external ${phase}`);
      const controller = new AbortController();
      if (phase === 'read')
        store.beforeRead = async () => {
          throw failure;
        };
      if (phase === 'delete')
        store.beforeDelete = async () => {
          throw failure;
        };
      vi.spyOn(network, 'fetch').mockImplementation(async () => {
        if (phase === 'fetch') throw failure;
        if (phase === 'body')
          return new Response(
            new ReadableStream({
              start(stream): void {
                stream.error(failure);
              },
            }),
          );
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      });
      const work =
        phase === 'fetch' || phase === 'body'
          ? MCPOAuthProvider.refreshAccessToken(
              config,
              'refresh',
              original.tokenUrl!,
              undefined,
              controller.signal,
            )
          : MCPOAuthProvider.getValidToken(
              tokenStorage,
              'shared',
              config,
              controller.signal,
            );
      expect(await observe(work).result).toBe(failure);
    });
  }

  it('keeps B rotation when A transport rejects after B persisted shared credentials', async () => {
    const a = new AbortController();
    const b = new AbortController();
    const entered = deferred<void>();
    const release = deferred<void>();
    const enteredB = deferred<void>();
    const releaseB = deferred<void>();
    const reason = new Error('only A');
    vi.spyOn(network, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.signal === a.signal) {
        entered.resolve();
        await release.promise;
        throw new Error('late A network failure');
      }
      enteredB.resolve();
      await releaseB.promise;
      return Response.json(rotated);
    });
    const workA = observe(
      MCPOAuthProvider.getValidToken(tokenStorage, 'shared', config, a.signal),
    );
    await entered.promise;
    const workB = observe(
      MCPOAuthProvider.getValidToken(tokenStorage, 'shared', config, b.signal),
    );
    await enteredB.promise;
    a.abort(reason);
    expect(store.credentials).toBe(original);
    await turn();
    expect(workA.settled()).toBe(false);
    expect(workB.settled()).toBe(false);
    releaseB.resolve();
    expect(await workB.result).toBe('rotated');
    release.resolve();
    expect(await workA.result).toBe(reason);
    expect(store.credentials?.token.refreshToken).toBe('refresh-rotated');
    expect(store.deletes).toBe(0);
    expect(b.signal.aborted).toBe(false);
  });

  it('retains successful refresh parameters, expiry, and omitted rotation fields', async () => {
    let submitted = new URLSearchParams();
    vi.spyOn(network, 'fetch').mockImplementation(async (_input, init) => {
      submitted = new URLSearchParams(String(init?.body));
      return new Response(
        'access_token=next&token_type=Bearer&expires_in=3600',
        { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
      );
    });
    const before = Date.now();
    expect(
      await MCPOAuthProvider.getValidToken(
        tokenStorage,
        'shared',
        config,
        new AbortController().signal,
      ),
    ).toBe('next');
    expect(Object.fromEntries(submitted)).toStrictEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-original',
      client_id: 'client',
      client_secret: 'secret',
      scope: 'read',
      audience: 'api',
      resource: 'https://mcp.invalid/',
    });
    expect(store.credentials?.token).toMatchObject({
      refreshToken: 'refresh-original',
      scope: 'read',
      tokenType: 'Bearer',
    });
    expect(store.credentials?.token.expiresAt).toBeGreaterThanOrEqual(
      before + 3600000,
    );
    expect(store.deletes).toBe(0);
  });

  it('retains invalid-token deletion policy without cancellation', async () => {
    vi.spyOn(network, 'fetch').mockImplementation(async () =>
      Response.json({ error: 'invalid_grant' }, { status: 400 }),
    );
    expect(
      await MCPOAuthProvider.getValidToken(
        tokenStorage,
        'shared',
        config,
        new AbortController().signal,
      ),
    ).toBeNull();
    expect(store.credentials).toBeNull();
  });

  it('aborts native refresh body reads and joins the actual read', async () => {
    const entered = deferred<void>();
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected TCP address');
    let bodyActive = false;
    vi.spyOn(network, 'fetch').mockImplementation(async (input, init) => {
      const response = await nativeFetch(input, init);
      const text = response.text.bind(response);
      response.text = async (): Promise<string> => {
        bodyActive = true;
        entered.resolve();
        try {
          return await text();
        } finally {
          bodyActive = false;
        }
      };
      return response;
    });
    const controller = new AbortController();
    const reason = new Error('native body cancelled');
    try {
      const work = observe(
        MCPOAuthProvider.refreshAccessToken(
          config,
          'refresh',
          `http://127.0.0.1:${address.port}/token`,
          undefined,
          controller.signal,
        ),
      );
      await entered.promise;
      controller.abort(reason);
      expect(await work.result).toBe(reason);
      expect(bodyActive).toBe(false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
