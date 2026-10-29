/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { once } from 'node:events';
import { OwnedFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { waitFor } from '../wait-for.js';
import {
  startLocalForwardProxy,
  type LocalForwardProxy,
} from './local-forward-proxy.js';

const MODEL_A = 'model-a.invalid';
const MODEL_B = 'model-b.invalid';
const MODELS_URL = `http://${MODEL_A}/v1/models`;
const WAIT = { timeout: 5000 };

function jsonResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('startLocalForwardProxy', () => {
  const proxies: LocalForwardProxy[] = [];
  const networks: OwnedFetch[] = [];

  async function startProxy(
    routes: Parameters<typeof startLocalForwardProxy>[0],
  ): Promise<LocalForwardProxy> {
    const proxy = await startLocalForwardProxy(routes);
    proxies.push(proxy);
    return proxy;
  }

  function networkThrough(proxy: LocalForwardProxy): OwnedFetch {
    const network = new OwnedFetch(proxy.url);
    networks.push(network);
    return network;
  }

  afterEach(async () => {
    for (const network of networks.splice(0)) {
      network.closeAdmissionAndAbort();
      await network.dispose();
    }
    for (const proxy of proxies.splice(0)) {
      await proxy.close();
    }
  });

  it('serves an OwnedFetch that uses it as its proxy and records the destination host', async () => {
    const proxy = await startProxy({
      [MODEL_A]: () => jsonResponse('{"data":[{"id":"model-a-canned"}]}'),
    });

    const response = await networkThrough(proxy).fetch(MODELS_URL);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"data":[{"id":"model-a-canned"}]}');
    expect(proxy.requests).toHaveLength(1);
    expect(proxy.requests[0]).toMatchObject({
      host: MODEL_A,
      method: 'GET',
      path: '/v1/models',
    });
  });

  it('is the only way a fake host resolves: a direct fetch of the same URL rejects', async () => {
    await startProxy({ [MODEL_A]: () => jsonResponse('{}') });

    await expect(globalThis.fetch(MODELS_URL)).rejects.toBeInstanceOf(Error);
  });

  it('routes each host to its own responder and passes the request body', async () => {
    const proxy = await startProxy({
      [MODEL_A]: (request) => jsonResponse(`a:${request.body}`),
      [MODEL_B]: (request) => jsonResponse(`b:${request.body}`),
    });
    const network = networkThrough(proxy);

    const first = await network.fetch(`http://${MODEL_A}/v1/chat`, {
      method: 'POST',
      body: 'one',
      headers: { 'x-trace': 'trace-1' },
    });
    const second = await network.fetch(`http://${MODEL_B}/v1/chat`, {
      method: 'POST',
      body: 'two',
    });

    expect(await first.text()).toBe('a:one');
    expect(await second.text()).toBe('b:two');
    expect(proxy.requestsTo(MODEL_A)).toHaveLength(1);
    expect(proxy.requestsTo(MODEL_A)[0].headers['x-trace']).toBe('trace-1');
    expect(proxy.requestsTo(MODEL_B)).toHaveLength(1);
  });

  it('answers 502 for an unknown host and records the attempt', async () => {
    const proxy = await startProxy({ [MODEL_A]: () => jsonResponse('{}') });

    const response = await networkThrough(proxy).fetch(
      'http://unknown.invalid/v1/models',
    );

    expect(response.status).toBe(502);
    expect(proxy.requestsTo('unknown.invalid')).toHaveLength(1);
  });

  it('handles an absolute-form request sent straight to the proxy', async () => {
    const proxy = await startProxy({
      [MODEL_A]: () => jsonResponse('absolute-canned'),
    });
    const proxyUrl = new URL(proxy.url);

    const body = await new Promise<string>((resolve, reject) => {
      const outgoing = httpRequest(
        {
          host: proxyUrl.hostname,
          port: proxyUrl.port,
          method: 'GET',
          path: MODELS_URL,
          headers: { host: MODEL_A },
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => resolve(Buffer.concat(chunks).toString()));
          incoming.on('error', reject);
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });

    expect(body).toBe('absolute-canned');
    expect(proxy.requests[0]).toMatchObject({
      host: MODEL_A,
      path: '/v1/models',
      via: 'absolute',
    });
  });

  it('terminates a CONNECT tunnel in process and applies the same route', async () => {
    const proxy = await startProxy({
      [MODEL_A]: () => jsonResponse('tunnel-canned'),
    });
    const proxyUrl = new URL(proxy.url);
    const socket = connect(Number(proxyUrl.port), proxyUrl.hostname);
    const received: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => received.push(chunk));
    await once(socket, 'connect');

    socket.write(
      `CONNECT ${MODEL_A}:80 HTTP/1.1\r\nHost: ${MODEL_A}:80\r\n\r\n`,
    );
    await waitFor(
      () =>
        expect(Buffer.concat(received).toString()).toContain(
          '200 Connection Established',
        ),
      WAIT,
    );
    socket.write(
      `GET /v1/models HTTP/1.1\r\nHost: ${MODEL_A}\r\nConnection: close\r\n\r\n`,
    );
    await once(socket, 'close');

    expect(Buffer.concat(received).toString()).toContain('tunnel-canned');
    expect(proxy.requests[0]).toMatchObject({
      host: MODEL_A,
      path: '/v1/models',
      via: 'connect',
    });
  });

  it('holds only the next request to a host until it is released', async () => {
    const proxy = await startProxy({
      [MODEL_A]: () => jsonResponse('released'),
    });
    const network = networkThrough(proxy);
    proxy.hold(MODEL_A);

    const held = network.fetch(MODELS_URL).then((response) => response.text());
    await waitFor(
      () => expect(proxy.requestsTo(MODEL_A)).toHaveLength(1),
      WAIT,
    );
    const later = await (await network.fetch(MODELS_URL)).text();
    expect(later).toBe('released');

    let settled = false;
    void held.then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(settled).toBe(false);

    proxy.release(MODEL_A);
    expect(await held).toBe('released');
  });

  it('ends a held request with a rejection when the proxy closes', async () => {
    const proxy = await startProxy({
      [MODEL_A]: () => jsonResponse('never-sent'),
    });
    const network = networkThrough(proxy);
    proxy.hold(MODEL_A);

    const held = network.fetch(MODELS_URL).then((response) => response.text());
    const heldOutcome = held.then(
      (value) => ({ rejected: false as const, value }),
      (error: unknown) => ({ rejected: true as const, error }),
    );
    await waitFor(
      () => expect(proxy.requestsTo(MODEL_A)).toHaveLength(1),
      WAIT,
    );

    await proxy.close();

    expect((await heldOutcome).rejected).toBe(true);
    expect(proxy.requestsTo(MODEL_A)[0].closed).toBe(true);
  });
});
