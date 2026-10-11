/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { OwnedFetch } from './fetch.js';

async function proxy(): Promise<{
  url: string;
  requests: () => number;
  close: () => Promise<void>;
}> {
  let requests = 0;
  const server = createServer();
  server.on('connect', (request, socket, head) => {
    requests += 1;
    const target = new URL(`http://${request.url}`);
    const upstream = connect(Number(target.port), target.hostname, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Expected proxy address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests: () => requests,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

describe('root-owned proxy fetch', () => {
  it('keeps two live proxy routes separate and joins held responses before releasing only its own dispatcher', async () => {
    const aProxy = await proxy();
    const bProxy = await proxy();
    const a = new OwnedFetch(aProxy.url);
    const b = new OwnedFetch(bProxy.url);
    const held = Promise.withResolvers<void>();
    const admitted = Promise.withResolvers<void>();
    const server = createServer((request, response) => {
      if (request.url === '/held') {
        admitted.resolve();
        void held.promise.then(() => response.end(request.url));
      } else {
        response.end(request.url);
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected target address');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const first = await a.fetch(`${url}/a`);
      expect(first.url).toBe(`${url}/a`);
      expect(await first.text()).toBe('/a');
      expect(await (await b.fetch(`${url}/b`)).text()).toBe('/b');
      const pending = a
        .fetch(`${url}/held`)
        .then((response) => response.text());
      await admitted.promise;
      let closed = false;
      const closing = a.dispose().then(() => {
        closed = true;
      });
      await Promise.resolve();
      expect(closed).toBe(false);
      await expect(a.fetch(`${url}/late`)).rejects.toThrow('closed');
      expect(await (await b.fetch(`${url}/still-live`)).text()).toBe(
        '/still-live',
      );
      held.resolve();
      expect(await pending).toBe('/held');
      await closing;
      await a.dispose();
      expect(aProxy.requests()).toBeGreaterThan(0);
      expect(bProxy.requests()).toBeGreaterThan(0);
      expect(await (await b.fetch(`${url}/after-a`)).text()).toBe('/after-a');
    } finally {
      held.resolve();
      await Promise.all([a.dispose(), b.dispose()]);
      await Promise.all([aProxy.close(), bProxy.close()]);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
