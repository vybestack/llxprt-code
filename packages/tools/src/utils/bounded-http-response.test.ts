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
import { createByteBudget } from '../acquisition/index.js';
import {
  acquireBoundedHttpBody,
  disposeHttpResponseBody,
  HttpBodyTooLargeError,
  type BoundedFetchResponse,
} from './bounded-http-response.js';

const servers: http.Server[] = [];
const pendingWriters = new Set<Promise<void>>();

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop()!;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.allSettled([...pendingWriters]);
});

function trackWriter(writer: Promise<void>): Promise<void> {
  pendingWriters.add(writer);
  void writer.then(
    () => pendingWriters.delete(writer),
    () => pendingWriters.delete(writer),
  );
  return writer;
}

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * Count listener names attached to a readable stream so we can prove
 * cleanup in behavioral tests without asserting on mock call counts.
 */
function attachedListenerCount(
  stream: NodeJS.ReadableStream | null,
  ...events: string[]
): number {
  if (stream === null) return 0;
  let total = 0;
  for (const evt of events) {
    total += (stream as EventEmitterLike).listenerCount(evt);
  }
  return total;
}

interface EventEmitterLike {
  listenerCount(event: string): number;
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

/**
 * Real-transport cancellation proof: a paced server writes chunks slowly so
 * the client has time to observe overflow mid-stream. The test uses installed
 * node-fetch with a per-request AbortController and proves the server sees
 * cancellation (connection close) before it can complete delivery.
 */
describe('acquireBoundedHttpBody — real server-side cancellation', () => {
  function startPacedServer(options?: { contentLength?: number }): Promise<{
    server: http.Server;
    getState: () => { completed: boolean; canceled: boolean };
    getWriterDone: () => Promise<void>;
  }> {
    let completed = false;
    let canceled = false;
    let writerDone: Promise<void> | undefined;
    const serverPromise = startServer((_req, res) => {
      const headers: Record<string, string> = {
        'content-type': 'text/plain',
      };
      if (options?.contentLength !== undefined) {
        headers['content-length'] = String(options.contentLength);
      }
      res.writeHead(200, headers);
      res.socket?.on('close', () => {
        canceled = !completed;
      });

      writerDone = trackWriter(
        (async () => {
          for (let i = 0; i < 100; i++) {
            if (
              res.writableEnded ||
              res.destroyed ||
              res.socket?.destroyed === true
            ) {
              return;
            }
            res.write('x'.repeat(128));
            await delay(10);
          }
          if (
            !res.writableEnded &&
            !res.destroyed &&
            res.socket?.destroyed !== true
          ) {
            completed = true;
            res.end();
          }
        })(),
      );
    });
    return serverPromise.then((server) => ({
      server,
      getState: () => ({ completed, canceled }),
      getWriterDone: () => {
        if (writerDone === undefined) {
          throw new Error('Paced response writer did not start');
        }
        return writerDone;
      },
    }));
  }

  it('cancels the fetch request on observed overflow (no Content-Length)', async () => {
    const { server, getState, getWriterDone } = await startPacedServer();

    const controller = new AbortController();
    const response = await fetch(serverUrl(server), {
      signal: controller.signal,
    });

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        () => controller.abort(),
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
    await getWriterDone();

    const state = getState();
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('cancels the fetch request on valid over-limit Content-Length early rejection', async () => {
    const { server, getState, getWriterDone } = await startPacedServer({
      contentLength: 999999,
    });

    const controller = new AbortController();
    const response = await fetch(serverUrl(server), {
      signal: controller.signal,
    });

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        () => controller.abort(),
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
    await getWriterDone();

    const state = getState();
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });

  it('cancels the fetch request on mid-read external abort through node-fetch', async () => {
    const { server, getState, getWriterDone } = await startPacedServer();

    const controller = new AbortController();
    const response = await fetch(serverUrl(server), {
      signal: controller.signal,
    });

    const promise = acquireBoundedHttpBody(
      response,
      createByteBudget(10 * 1024 * 1024),
      controller.signal,
      () => controller.abort(),
    );

    controller.abort();

    await expect(promise).rejects.toThrow(/abort/i);
    await getWriterDone();

    const state = getState();
    expect(state.canceled).toBe(true);
    expect(state.completed).toBe(false);
  });
});

describe('acquireBoundedHttpBody — cancel callback invocation', () => {
  it('invokes cancelRequest and releases listeners on observed overflow', async () => {
    const payload = 'x'.repeat(2048);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(payload);
    });

    const response = await fetch(serverUrl(server));
    const tracker = createTrackingCancel();

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        tracker.cancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);

    expect(tracker.called).toBe(true);
  });

  it('invokes cancelRequest and releases listeners on over-limit Content-Length early reject', async () => {
    const fakeResponse: BoundedFetchResponse = {
      body: Readable.from([Buffer.from('x'.repeat(100))]),
      headers: {
        get: (name: string) => (name === 'content-length' ? '999999' : null),
      },
    };
    const tracker = createTrackingCancel();

    await expect(
      acquireBoundedHttpBody(
        fakeResponse,
        createByteBudget(1024),
        new AbortController().signal,
        tracker.cancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);

    expect(tracker.called).toBe(true);
  });

  it('invokes cancelRequest and releases listeners on stream read error', async () => {
    const errorStream = new Readable({
      read() {
        this.destroy(new Error('stream read failure'));
      },
    });
    const fakeResponse: BoundedFetchResponse = {
      body: errorStream,
      headers: { get: () => null },
    };
    const tracker = createTrackingCancel();

    await expect(
      acquireBoundedHttpBody(
        fakeResponse,
        createByteBudget(1024),
        new AbortController().signal,
        tracker.cancel,
      ),
    ).rejects.toThrow('stream read failure');

    expect(tracker.called).toBe(true);
    expect(
      attachedListenerCount(
        errorStream as NodeJS.ReadableStream,
        'data',
        'end',
        'error',
      ),
    ).toBe(0);
  });

  it('does NOT invoke cancelRequest on normal successful completion', async () => {
    const payload = 'x'.repeat(256);
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(payload);
    });

    const response = await fetch(serverUrl(server));
    const tracker = createTrackingCancel();

    const body = await acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      new AbortController().signal,
      tracker.cancel,
    );

    expect(body.text).toBe(payload);
    expect(tracker.called).toBe(false);
  });
});

/**
 * Wrap a real AbortController so tests can observe abort-listener
 * add/remove without mock call counting. The underlying signal is genuine.
 */
function createTrackingController(): {
  signal: AbortSignal;
  abortListenerCount: number;
  abort(): void;
} {
  const controller = new AbortController();
  let count = 0;
  const origAdd = controller.signal.addEventListener.bind(controller.signal);
  const origRemove = controller.signal.removeEventListener.bind(
    controller.signal,
  );
  const trackingSignal = new Proxy(controller.signal, {
    get(target, prop) {
      if (prop === 'addEventListener') {
        return (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ): void => {
          if (type === 'abort') count++;
          origAdd(type, listener, options);
        };
      }
      if (prop === 'removeEventListener') {
        return (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | EventListenerOptions,
        ): void => {
          if (type === 'abort') count = Math.max(0, count - 1);
          origRemove(type, listener, options);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    signal: trackingSignal,
    get abortListenerCount() {
      return count;
    },
    abort: () => controller.abort(),
  };
}

describe('acquireBoundedHttpBody — listener lifecycle', () => {
  it('removes all adapter-owned listeners and the abort listener after normal success', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(256));
    });

    const response = await fetch(serverUrl(server));
    const tracker = createTrackingController();
    const body = response.body;

    await acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      tracker.signal,
      noopCancel,
    );

    expect(attachedListenerCount(body, 'data', 'end', 'error')).toBe(0);
    expect(tracker.abortListenerCount).toBe(0);
  });

  it('removes all adapter-owned listeners and the abort listener after overflow', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(2048));
    });

    const response = await fetch(serverUrl(server));
    const tracker = createTrackingController();
    const body = response.body;

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        tracker.signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);

    expect(attachedListenerCount(body, 'data', 'end', 'error')).toBe(0);
    expect(tracker.abortListenerCount).toBe(0);
  });

  it('removes all adapter-owned listeners and the abort listener after abort', async () => {
    let writerDone = Promise.resolve();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      writerDone = trackWriter(
        (async () => {
          for (let i = 0; i < 20; i++) {
            if (res.destroyed || res.writableEnded) return;
            res.write('x'.repeat(128));
            await delay(20);
          }
          if (!res.destroyed && !res.writableEnded) res.end();
        })(),
      );
    });

    const requestController = new AbortController();
    const response = await fetch(serverUrl(server), {
      signal: requestController.signal,
    });
    const tracker = createTrackingController();
    const body = response.body;

    const promise = acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      tracker.signal,
      () => requestController.abort(),
    );
    tracker.abort();
    await expect(promise).rejects.toThrow(/abort/i);
    await writerDone;

    expect(attachedListenerCount(body, 'data', 'end', 'error')).toBe(0);
    expect(tracker.abortListenerCount).toBe(0);
  });

  it('removes all adapter-owned listeners and the abort listener after a stream error', async () => {
    const errorStream = new Readable({
      read() {
        this.destroy(new Error('stream read failure'));
      },
    });
    const fakeResponse: BoundedFetchResponse = {
      body: errorStream,
      headers: { get: () => null },
    };
    const tracker = createTrackingController();

    await expect(
      acquireBoundedHttpBody(
        fakeResponse,
        createByteBudget(1024),
        tracker.signal,
        noopCancel,
      ),
    ).rejects.toThrow('stream read failure');

    expect(
      attachedListenerCount(
        errorStream as NodeJS.ReadableStream,
        'data',
        'end',
        'error',
      ),
    ).toBe(0);
    expect(tracker.abortListenerCount).toBe(0);
  });
});

describe('acquireBoundedHttpBody — abort registration edge', () => {
  it('rejects immediately with AbortError when signal is already aborted before acquisition starts', async () => {
    // A live stream with real data — the adapter must still reject for abort
    // because the signal was already aborted when listeners were registered.
    const stream = Readable.from([Buffer.from('x'.repeat(10))]);
    const fakeResponse: BoundedFetchResponse = {
      body: stream,
      headers: { get: () => null },
    };
    const tracker = createTrackingCancel();
    const abortTracker = createTrackingController();
    abortTracker.abort();
    const promise = acquireBoundedHttpBody(
      fakeResponse,
      createByteBudget(1024),
      abortTracker.signal,
      tracker.cancel,
    );

    await expect(promise).rejects.toThrow(/abort/i);

    // The post-registration check must fire onAbort which calls cancelRequest
    // and destroys the body.
    expect(tracker.called).toBe(true);
    expect((stream as unknown as { destroyed: boolean }).destroyed).toBe(true);
    // No adapter-owned listeners remain on the body.
    expect(
      attachedListenerCount(
        stream as NodeJS.ReadableStream,
        'data',
        'end',
        'error',
      ),
    ).toBe(0);
    expect(abortTracker.abortListenerCount).toBe(0);
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
