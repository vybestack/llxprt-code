/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type http from 'node:http';
import net from 'node:net';
import {
  collectRequestBody,
  createLoopbackHarness,
} from './loopback-test-helpers.js';

const ROUTED_ORIGIN = 'https://example.test';
const loopback = createLoopbackHarness(ROUTED_ORIGIN);

async function startInterruptedCollection(
  interrupt: (req: http.IncomingMessage) => void,
): Promise<{
  clientSocket: net.Socket;
  collection: Promise<string>;
}> {
  const started = Promise.withResolvers<{ collection: Promise<string> }>();
  const server = await loopback.startServer(async (req, res) => {
    const collection = collectRequestBody(req);
    started.resolve({ collection });
    queueMicrotask(() => interrupt(req));
    await collection.catch(() => undefined);
    res.destroy();
  });
  const serverUrl = new URL(loopback.serverUrl(server));
  const connected = Promise.withResolvers<void>();
  const clientSocket = net.createConnection(
    {
      host: serverUrl.hostname,
      port: Number(serverUrl.port),
    },
    () => connected.resolve(),
  );
  clientSocket.on('error', () => undefined);
  await connected.promise;
  clientSocket.write(
    'POST / HTTP/1.1\r\nHost: example.test\r\nContent-Length: 100\r\n\r\npartial',
  );

  const { collection } = await started.promise;
  return { clientSocket, collection };
}

describe('loopback test helpers', () => {
  it('rejects body collection when the incoming request emits an error', async () => {
    const failure = new Error('forced incoming request failure');
    const { clientSocket, collection } = await startInterruptedCollection(
      (req) => {
        req.emit('error', failure);
      },
    );

    await expect(collection).rejects.toBe(failure);
    clientSocket.destroy();
  });

  it('rejects body collection when the incoming request is aborted', async () => {
    const { clientSocket, collection } = await startInterruptedCollection(
      (req) => {
        req.emit('aborted');
      },
    );

    await expect(collection).rejects.toThrow(
      'Request aborted before body completed',
    );
    clientSocket.destroy();
  });

  it('preserves Request metadata while replacing the routed origin', async () => {
    const observed = Promise.withResolvers<{
      body: string;
      header: string | string[] | undefined;
      method: string | undefined;
      url: string | undefined;
    }>();
    const server = await loopback.startServer(async (req, res) => {
      observed.resolve({
        body: await collectRequestBody(req),
        header: req.headers['x-route-marker'],
        method: req.method,
        url: req.url,
      });
      res.end('routed');
    });
    loopback.installFetchRouter(server);

    const response = await fetch(
      new Request(`${ROUTED_ORIGIN}/request-path?value=1`, {
        method: 'POST',
        headers: { 'x-route-marker': 'preserved' },
        body: 'request-body',
      }),
    );

    expect(await response.text()).toBe('routed');
    expect(await observed.promise).toStrictEqual({
      body: 'request-body',
      header: 'preserved',
      method: 'POST',
      url: '/request-path?value=1',
    });
  });

  it('preserves an abort signal carried by a routed Request', async () => {
    const server = await loopback.startServer((_req, res) => {
      res.end('unexpected');
    });
    loopback.installFetchRouter(server);
    const controller = new AbortController();
    const request = new Request(`${ROUTED_ORIGIN}/abort`, {
      signal: controller.signal,
    });
    controller.abort();

    await expect(fetch(request)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects requests to origins outside the installed route', async () => {
    const routedServer = await loopback.startServer((_req, res) => {
      res.end('routed');
    });
    const outsideServer = await loopback.startServer((_req, res) => {
      res.end('outside');
    });
    loopback.installFetchRouter(routedServer);

    await expect(fetch(loopback.serverUrl(outsideServer))).rejects.toThrow(
      `Refusing unrouted fetch; expected ${ROUTED_ORIGIN}`,
    );
  });
});
