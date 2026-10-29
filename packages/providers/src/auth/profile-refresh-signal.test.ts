/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { CodexOAuthProvider } from './codex-oauth-provider.js';
import type { OAuthProvider } from './types.js';
import type { OAuthFetch } from '@vybestack/llxprt-code-auth/types.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from './__tests__/behavioral/test-utils.js';

function createRefreshGate(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {};
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function nativeRefreshServer(
  handle: () => Promise<void> | void,
): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const sockets = new Set<Socket>();
  const pending = new Set<Promise<void>>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.once('data', () => {
      const response = Promise.resolve()
        .then(handle)
        .then(() => {
          socket.end(
            [
              'HTTP/1.1 503 Service Unavailable',
              'Connection: close',
              'Content-Length: 19',
              '',
              'Refresh unavailable',
            ].join(String.fromCharCode(13, 10)),
          );
        });
      pending.add(response);
      void response.then(() => pending.delete(response));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected native HTTP port');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await Promise.all(pending);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}

describe('profile refresh cancellation', () => {
  it.each([false, true])(
    'keeps native Codex provider unavailability as null outside manager ownership (signal=%s)',
    async (withSignal) => {
      let requests = 0;
      const server = await nativeRefreshServer(() => {
        requests++;
      });
      const requestFetch: OAuthFetch = (_input, init) =>
        fetch(server.url, init);
      const provider = new CodexOAuthProvider(
        requestFetch,
        new MemoryTokenStore(),
      );
      try {
        expect(
          await provider.refreshToken(
            makeExpiredToken('expired-codex'),
            withSignal ? new AbortController().signal : undefined,
          ),
        ).toBeNull();
        expect(requests).toBe(1);
      } finally {
        await server.close();
      }
    },
  );

  it('preserves native Codex request cancellation identity outside manager ownership', async () => {
    const entered = createRefreshGate();
    const held = createRefreshGate();
    const controller = new AbortController();
    const cancellation = new Error('Profile retired over native HTTP');
    const server = await nativeRefreshServer(async () => {
      entered.resolve();
      await held.promise;
    });
    const requestFetch: OAuthFetch = (_input, init) => fetch(server.url, init);
    const provider = new CodexOAuthProvider(
      requestFetch,
      new MemoryTokenStore(),
    );
    const pending = provider
      .refreshToken(makeExpiredToken('expired-codex'), controller.signal)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    try {
      await entered.promise;
      controller.abort(cancellation);
      expect(await pending).toBe(cancellation);
    } finally {
      held.resolve();
      await pending;
      await server.close();
    }
  });

  it('forwards profile refresh cancellation through the real Codex HTTP deadline', async () => {
    const owner = new AbortController();
    const cancellation = new Error('Profile retired');
    let reached = (): void => {};
    const entered = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release = (): void => {};
    let transportSignal: AbortSignal | null | undefined;
    const { preconnect } = globalThis.fetch;
    const transport = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          transportSignal = init?.signal;
          const signal = transportSignal;
          reached();
          return new Promise<Response>((resolve, reject) => {
            const onAbort = (): void => reject(signal?.reason);
            signal?.addEventListener('abort', onAbort, { once: true });
            release = () => {
              signal?.removeEventListener('abort', onAbort);
              resolve(
                Response.json({
                  access_token: 'rotated',
                  refresh_token: 'rotated-refresh',
                  token_type: 'Bearer',
                  expires_in: 120,
                }),
              );
            };
          });
        },
        { preconnect },
      ),
    );
    const provider: OAuthProvider = new CodexOAuthProvider(
      globalThis.fetch,
      new MemoryTokenStore(),
    );
    const result = provider
      .refreshToken(makeExpiredToken('expired-codex'), owner.signal)
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    try {
      await entered;
      owner.abort(cancellation);
      expect(transportSignal?.aborted).toBe(true);
      expect(await result).toStrictEqual({ error: cancellation });
    } finally {
      release();
      await result;
      transport.mockRestore();
    }
  }, 30000);
});
