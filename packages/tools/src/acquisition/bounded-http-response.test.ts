/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { describe, it, expect, afterEach } from 'bun:test';
import fetch from 'node-fetch';
import { createByteBudget } from './index.js';
import {
  acquireBoundedHttpBody,
  disposeHttpResponseBody,
  HttpBodyTooLargeError,
  type BoundedFetchResponse,
} from './bounded-http-response.js';

const servers: http.Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      servers.push(server);
      resolve(server);
    });
  });
}

function serverUrl(server: http.Server): string {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/`;
}

function fragmentPayload(payload: string, fragmentSize: number): Buffer[] {
  const buf = Buffer.from(payload);
  const fragments: Buffer[] = [];
  for (let i = 0; i < buf.length; i += fragmentSize) {
    fragments.push(buf.subarray(i, i + fragmentSize));
  }
  return fragments;
}

/** No-op cancel for tests that do not exercise cancellation behavior. */
const noopCancel = (): void => {};

/**
 * Creates a cancel callback that records whether it was invoked.
 */
function createTrackingCancel(): { cancel: () => void; called: boolean } {
  let called = false;
  return {
    cancel: () => {
      called = true;
    },
    get called() {
      return called;
    },
  };
}

describe('acquireBoundedHttpBody — under-budget streaming', () => {
  it('reads a real local chunked response under budget', async () => {
    const payload = 'x'.repeat(512);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(payload);
    });

    const response = await fetch(serverUrl(server));
    const body = await acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      new AbortController().signal,
      noopCancel,
    );

    expect(body.text).toBe(payload);
    expect(body.metadata.observedBytes).toBe(512);
    expect(body.metadata.truncated).toBe(false);
  });

  it('succeeds when fragmented chunks exactly equal the budget', async () => {
    const payload = 'x'.repeat(1024);
    const fragments = fragmentPayload(payload, 7);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      for (const frag of fragments) {
        res.write(frag);
      }
      res.end();
    });

    const response = await fetch(serverUrl(server));
    const body = await acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      new AbortController().signal,
      noopCancel,
    );

    expect(body.text).toBe(payload);
    expect(body.metadata.observedBytes).toBe(1024);
    expect(body.metadata.truncated).toBe(false);
  });
});

describe('acquireBoundedHttpBody — overflow detection', () => {
  it('fails when a missing-Content-Length response exceeds the budget and closes the body', async () => {
    const payload = 'x'.repeat(2048);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write(payload);
      res.end();
    });

    const response = await fetch(serverUrl(server));
    const budget = createByteBudget(1024);

    await expect(
      acquireBoundedHttpBody(
        response,
        budget,
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);

    expect(
      (response.body as unknown as { destroyed: boolean } | null)?.destroyed,
    ).toBe(true);
  });

  it('fails atomically when fragmented chunks are one byte over the budget and closes the body', async () => {
    const payload = 'x'.repeat(1025);
    const fragments = fragmentPayload(payload, 3);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      for (const frag of fragments) {
        res.write(frag);
      }
      res.end();
    });

    const response = await fetch(serverUrl(server));

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);

    expect(
      (response.body as unknown as { destroyed: boolean } | null)?.destroyed,
    ).toBe(true);
  });

  it('fails on observed bytes when Content-Length advertises less than the stream sends', async () => {
    const fakeResponse: BoundedFetchResponse = {
      body: Readable.from([Buffer.from('x'.repeat(2048))]),
      headers: {
        get: (name: string) => (name === 'content-length' ? '512' : null),
      },
    };

    await expect(
      acquireBoundedHttpBody(
        fakeResponse,
        createByteBudget(1024),
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
  });

  it('rejects an over-limit Content-Length before iteration and closes the body', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': '999999',
      });
      res.end('x'.repeat(999999));
    });

    const response = await fetch(serverUrl(server));
    const budget = createByteBudget(1024);

    await expect(
      acquireBoundedHttpBody(
        response,
        budget,
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);

    expect(
      (response.body as unknown as { destroyed: boolean } | null)?.destroyed,
    ).toBe(true);
  });
});

describe('acquireBoundedHttpBody — strict Content-Length parsing', () => {
  it('treats a malformed over-limit-looking Content-Length as absent and succeeds with a bounded body', async () => {
    const payload = 'x'.repeat(512);
    const fakeResponse: BoundedFetchResponse = {
      body: Readable.from([Buffer.from(payload)]),
      headers: {
        get: (name: string) =>
          name === 'content-length' ? '9999999999;foo' : null,
      },
    };

    const body = await acquireBoundedHttpBody(
      fakeResponse,
      createByteBudget(1024),
      new AbortController().signal,
      noopCancel,
    );

    expect(body.text).toBe(payload);
    expect(body.metadata.observedBytes).toBe(512);
  });

  it('treats a malformed understated-looking Content-Length as absent but fails when observed bytes exceed budget', async () => {
    const payload = 'x'.repeat(2048);
    const fakeResponse: BoundedFetchResponse = {
      body: Readable.from([Buffer.from(payload)]),
      headers: {
        get: (name: string) => (name === 'content-length' ? 'abc' : null),
      },
    };

    await expect(
      acquireBoundedHttpBody(
        fakeResponse,
        createByteBudget(1024),
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
  });

  it('rejects an unsafe (non-safe-integer) Content-Length as absent and streams observed bytes', async () => {
    const payload = 'x'.repeat(256);
    const fakeResponse: BoundedFetchResponse = {
      body: Readable.from([Buffer.from(payload)]),
      headers: {
        get: (name: string) =>
          name === 'content-length' ? '99999999999999999999999' : null,
      },
    };

    const body = await acquireBoundedHttpBody(
      fakeResponse,
      createByteBudget(1024),
      new AbortController().signal,
      noopCancel,
    );

    expect(body.text).toBe(payload);
    expect(body.metadata.observedBytes).toBe(256);
  });
});

describe('acquireBoundedHttpBody — exact byte boundary', () => {
  it('succeeds when body bytes exactly equal the budget', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(1024));
    });

    const response = await fetch(serverUrl(server));
    const body = await acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      new AbortController().signal,
      noopCancel,
    );

    expect(body.metadata.observedBytes).toBe(1024);
    expect(body.text).toBe('x'.repeat(1024));
  });

  it('fails when body is one byte over the budget', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('x'.repeat(1025));
      res.end();
    });

    const response = await fetch(serverUrl(server));

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
  });

  it('counts UTF-8 bytes, not JavaScript characters, for the boundary', async () => {
    // "é" is 1 character but 2 UTF-8 bytes. 512 × "é" = 1024 bytes = budget.
    const payload = 'é'.repeat(512);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.write(payload);
      res.end();
    });

    const response = await fetch(serverUrl(server));
    const body = await acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      new AbortController().signal,
      noopCancel,
    );

    expect(body.text).toBe(payload);
    expect(body.metadata.observedBytes).toBe(1024);
  });

  it('fails when a multibyte UTF-8 body is one byte over budget', async () => {
    // 512 × "é" = 1024 bytes. Adding one ASCII byte → 1025 > 1024.
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.write('é'.repeat(512) + 'x');
      res.end();
    });

    const response = await fetch(serverUrl(server));

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
  });
});

describe('disposeHttpResponseBody', () => {
  it('cancels the request and destroys the response body without reading it', () => {
    const stream = Readable.from([Buffer.from('error body')]);
    const fakeResponse: BoundedFetchResponse = {
      body: stream,
      headers: { get: () => null },
    };
    const tracker = createTrackingCancel();

    disposeHttpResponseBody(fakeResponse, tracker.cancel);

    expect((stream as unknown as { destroyed: boolean }).destroyed).toBe(true);
    expect(tracker.called).toBe(true);
  });

  it('is a no-op on body when body is null but still invokes cancelRequest', () => {
    const fakeResponse: BoundedFetchResponse = {
      body: null,
      headers: { get: () => null },
    };
    const tracker = createTrackingCancel();
    expect(() =>
      disposeHttpResponseBody(fakeResponse, tracker.cancel),
    ).not.toThrow();
    expect(tracker.called).toBe(true);
  });
});
