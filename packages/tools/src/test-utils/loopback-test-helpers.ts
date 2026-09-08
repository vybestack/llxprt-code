/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type LoopbackHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void | Promise<void>;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface LoopbackHarness {
  startServer(handler: LoopbackHandler): Promise<http.Server>;
  serverUrl(server: http.Server): string;
  installFetchRouter(server: http.Server): void;
  trackWriter(writer: Promise<void>): void;
  settleWriters(): Promise<void>;
}

export interface KeyStorageLike {
  resolveKey(name: string): Promise<string | null>;
}

export function createLoopbackHarness(routedOrigin?: string): LoopbackHarness {
  const nativeFetch = globalThis.fetch;
  const servers: http.Server[] = [];
  const pendingWriters = new Set<Promise<void>>();
  let routerInstalled = false;

  afterEach(async () => {
    if (routerInstalled) {
      setGlobalFetch(nativeFetch);
      routerInstalled = false;
    }
    await closeServers(servers);
    await Promise.allSettled([...pendingWriters]);
  });

  const installFetchRouter = (server: http.Server): void => {
    if (routedOrigin === undefined) {
      throw new Error('Expected a routed origin for the fetch router');
    }
    if (routerInstalled) {
      throw new Error('The fetch router is already installed');
    }
    setGlobalFetch(createFetchRouter(server, routedOrigin, nativeFetch));
    routerInstalled = true;
  };

  const trackWriter = (writer: Promise<void>): void => {
    pendingWriters.add(writer);
    void writer.then(
      () => pendingWriters.delete(writer),
      () => pendingWriters.delete(writer),
    );
  };

  return {
    startServer: (handler: LoopbackHandler): Promise<http.Server> =>
      startServer(handler, servers),
    serverUrl: (server: http.Server): string =>
      `http://127.0.0.1:${serverPort(server)}/`,
    installFetchRouter,
    trackWriter,
    settleWriters: async (): Promise<void> => {
      await Promise.allSettled([...pendingWriters]);
    },
  };
}

export function collectRequestBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    let settled = false;
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
    };
    const cleanup = (): void => {
      req.removeListener('data', onData);
      req.removeListener('end', settleSuccess);
      req.removeListener('error', settleFailure);
      req.removeListener('aborted', settleAborted);
      req.removeListener('close', settleClosed);
    };
    const settleSuccess = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const settleFailure = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    const settleAborted = (): void => {
      settleFailure(new Error('Request aborted before body completed'));
    };
    const settleClosed = (): void => {
      if (!req.complete) {
        settleAborted();
      }
    };

    req.on('data', onData);
    req.once('end', settleSuccess);
    req.once('error', settleFailure);
    req.once('aborted', settleAborted);
    req.once('close', settleClosed);
  });
}

export function createKeyStorage(
  resolveKey: (name: string) => Promise<string | null> = async () => null,
): KeyStorageLike {
  return { resolveKey };
}

function startServer(
  handler: LoopbackHandler,
  servers: http.Server[],
): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      Promise.resolve(handler(req, res)).catch((error: unknown) => {
        res.destroy(normalizeError(error));
      });
    });
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      servers.push(server);
      resolve(server);
    });
  });
}

async function closeServers(servers: http.Server[]): Promise<void> {
  let server: http.Server | undefined = servers.pop();
  while (server !== undefined) {
    const currentServer = server;
    currentServer.closeAllConnections();
    await new Promise<void>((resolve) => currentServer.close(() => resolve()));
    server = servers.pop();
  }
}

function createFetchRouter(
  server: http.Server,
  routedOrigin: string,
  nativeFetch: FetchImplementation,
): FetchImplementation {
  const loopbackOrigin = `http://127.0.0.1:${serverPort(server)}`;
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const inputUrl = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    if (inputUrl.origin !== routedOrigin) {
      return Promise.reject(
        new Error(`Refusing unrouted fetch; expected ${routedOrigin}`),
      );
    }
    const loopbackUrl = new URL(inputUrl);
    const replacementOrigin = new URL(loopbackOrigin);
    loopbackUrl.protocol = replacementOrigin.protocol;
    loopbackUrl.hostname = replacementOrigin.hostname;
    loopbackUrl.port = replacementOrigin.port;
    const routedInput =
      input instanceof Request ? new Request(loopbackUrl, input) : loopbackUrl;
    return nativeFetch(routedInput, init);
  };
}

function setGlobalFetch(fetchImplementation: FetchImplementation): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchImplementation,
  });
}

function serverPort(server: http.Server): number {
  const address: string | AddressInfo | null = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('Expected a listening server address with a port');
  }
  const { port } = address;
  if (typeof port !== 'number') {
    throw new Error('Expected a numeric listening port');
  }
  return port;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
