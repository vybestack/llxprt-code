/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type RequestListener, type Server } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { OwnedFetch } from './fetch.js';

describe('owned fetch HTTP semantics', () => {
  const servers: Server[] = [];
  const owners: OwnedFetch[] = [];
  afterEach(async () => {
    const results = await Promise.allSettled(
      owners.splice(0).map((owner) => owner.dispose()),
    );
    const retired = await Promise.allSettled(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
    const failures = [...results, ...retired].flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'HTTP fixture release failed');
  });
  async function endpoint(listener: RequestListener): Promise<string> {
    const server = createServer(listener);
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing HTTP address');
    return `http://127.0.0.1:${address.port}`;
  }
  function acquire(): OwnedFetch {
    const owner = new OwnedFetch();
    owners.push(owner);
    return owner;
  }

  it.each([32, 131072, 1048576])(
    'sends an existing Request body of %i bytes when a caller replaces only its signal',
    async (size) => {
      const content = 'x'.repeat(size);
      const url = await endpoint((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
          body += chunk;
        });
        request.on('end', () =>
          response.end(JSON.stringify({ body, method: request.method })),
        );
      });
      const request = new Request(url, {
        method: 'POST',
        body: content,
      });
      const response = await acquire().fetch(request, {
        signal: AbortSignal.timeout(1500),
      });
      expect(await response.json()).toStrictEqual({
        body: content,
        method: 'POST',
      });
    },
  );

  it('preserves headers through a real GET redirect, decompresses the response and records its final URL', async () => {
    const received: Array<{
      method: string | undefined;
      body: string;
      header: string | undefined;
    }> = [];
    const url = await endpoint((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        received.push({
          method: request.method,
          body,
          header: request.headers['x-owner']?.toString(),
        });
        if (request.url === '/redirect')
          response.writeHead(307, { location: '/final' }).end();
        else
          response
            .writeHead(201, {
              'content-encoding': 'gzip',
              'content-type': 'text/plain',
            })
            .end(gzipSync(`received ${body}`));
      });
    });
    const response = await acquire().fetch(`${url}/redirect`, {
      headers: { 'x-owner': 'specific-owner' },
    });
    const clone = response.clone();
    expect(clone.url).toBe(response.url);
    expect(clone.redirected).toBe(true);
    expect(await clone.text()).toBe('received ');
    expect(response.status).toBe(201);
    expect(await response.text()).toBe('received ');
    expect(received).toStrictEqual([
      { method: 'GET', body: '', header: 'specific-owner' },
      { method: 'GET', body: '', header: 'specific-owner' },
    ]);
    expect(response.url).toBe(`${url}/final`);
    expect(response.redirected).toBe(true);
    expect(response.type).toBe('basic');
  });

  it('replays a scalar request body on a 307 without changing method or leaking headers across origins', async () => {
    const received: Array<{
      method: string | undefined;
      body: string;
      authorization: string | undefined;
    }> = [];
    const final = await endpoint((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        received.push({
          method: request.method,
          body,
          authorization: request.headers.authorization,
        });
        response.end('replayed request');
      });
    });
    const start = await endpoint((request, response) => {
      request.resume();
      request.on('end', () =>
        response.writeHead(307, { location: `${final}/destination` }).end(),
      );
    });
    const response = await acquire().fetch(start, {
      method: 'POST',
      body: 'repeatable payload',
      headers: { authorization: 'Bearer original-origin-only' },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('replayed request');
    expect(received).toStrictEqual([
      { method: 'POST', body: 'repeatable payload', authorization: undefined },
    ]);
    expect(response.url).toBe(`${final}/destination`);
  });

  it('sends the complete actual POST body and caller headers', async () => {
    const url = await endpoint((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () =>
        response.end(
          JSON.stringify({
            body,
            method: request.method,
            header: request.headers['x-owner'],
          }),
        ),
      );
    });
    const response = await acquire().fetch(url, {
      method: 'POST',
      body: 'actual complete body',
      headers: { 'x-owner': 'body-owner' },
    });
    expect(await response.json()).toStrictEqual({
      body: 'actual complete body',
      method: 'POST',
      header: 'body-owner',
    });
  });

  it('does not follow manual or forbidden redirects and drains the manual response independently', async () => {
    const paths: string[] = [];
    const url = await endpoint((request, response) => {
      paths.push(request.url ?? 'missing path');
      response
        .writeHead(302, { location: '/never' })
        .end('manual redirect body');
    });
    const owner = acquire();
    const manual = await owner.fetch(`${url}/manual`, { redirect: 'manual' });
    expect(manual.status).toBe(302);
    expect(await manual.text()).toBe('manual redirect body');
    expect(manual.redirected).toBe(false);
    await expect(
      owner.fetch(`${url}/forbidden`, { redirect: 'error' }),
    ).rejects.toThrow('Fetch redirect is not allowed');
    expect(paths).toStrictEqual(['/manual', '/forbidden']);
  });

  it.each([204, 205, 304])(
    'retains null-body status %i without inventing a response body',
    async (status) => {
      const url = await endpoint((_request, response) => {
        response.writeHead(status).end();
      });
      const response = await acquire().fetch(url);
      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
      expect(await response.text()).toBe('');
    },
  );

  it('rejects a distinct-location redirect chain at the Fetch limit without requesting beyond it', async () => {
    const paths: string[] = [];
    const url = await endpoint((request, response) => {
      const path = request.url ?? '/0';
      paths.push(path);
      const index = Number(path.slice(1));
      response
        .writeHead(302, { location: `/${index + 1}` })
        .end('redirect chain');
    });
    await expect(acquire().fetch(`${url}/0`)).rejects.toThrow('redirect');
    expect(paths).toHaveLength(21);
    expect(paths[20]).toBe('/20');
  });

  it('retains HEAD response metadata with a null body and leaves its owner usable for a later GET', async () => {
    const methods: string[] = [];
    const url = await endpoint((request, response) => {
      methods.push(request.method ?? '');
      response
        .writeHead(200, { 'content-length': '7', 'content-type': 'text/plain' })
        .end(request.method === 'HEAD' ? undefined : 'payload');
    });
    const owner = acquire();
    const head = await owner.fetch(url, { method: 'HEAD' });
    expect(head.body).toBeNull();
    expect(await head.text()).toBe('');
    expect(head.headers.get('content-length')).toBe('7');
    expect(await (await owner.fetch(url)).text()).toBe('payload');
    expect(methods).toStrictEqual(['HEAD', 'GET']);
  });

  it('does not acquire a network request for an already-aborted caller and retains its exact reason', async () => {
    let requests = 0;
    const url = await endpoint((_request, response) => {
      requests++;
      response.end('not reached');
    });
    const signal = new AbortController();
    const reason = new Error('caller stopped before admission');
    signal.abort(reason);
    const owner = acquire();
    await expect(owner.fetch(url, { signal: signal.signal })).rejects.toBe(
      reason,
    );
    expect(requests).toBe(0);
    expect(await (await owner.fetch(url)).text()).toBe('not reached');
    expect(requests).toBe(1);
  });
});
