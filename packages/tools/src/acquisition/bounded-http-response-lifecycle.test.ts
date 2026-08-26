/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lifecycle tests for acquireBoundedHttpBody: cancellation, cancel-callback
 * invocation, listener cleanup, abort registration edges, and premature-close
 * settlement. Split from bounded-http-response.test.ts to keep each file under
 * the source-size limit.
 *
 * @plan PLAN-20260810-ISSUE3202
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { describe, it, expect, afterEach } from 'bun:test';
import fetch from 'node-fetch';
import { createByteBudget } from './index.js';
import {
  acquireBoundedHttpBody,
  HttpBodyTooLargeError,
  type BoundedFetchResponse,
} from './bounded-http-response.js';

describe('acquireBoundedHttpBody lifecycle', () => {
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

  describe('acquireBoundedHttpBody — real server-side cancellation', () => {
    function startPacedServer(options?: { contentLength?: number }): Promise<{
      server: http.Server;
      getState: () => { completed: boolean; canceled: boolean };
      getWriterDone: () => Promise<void>;
      getSocketClosed: () => Promise<void>;
    }> {
      let completed = false;
      let canceled = false;
      let writerDone: Promise<void> | undefined;
      let socketClosed: Promise<void> | undefined;
      const serverPromise = startServer((_req, res) => {
        const headers: Record<string, string> = {
          'content-type': 'text/plain',
        };
        if (options?.contentLength !== undefined) {
          headers['content-length'] = String(options.contentLength);
        }
        res.writeHead(200, headers);

        const socket = res.socket;
        if (socket === null) {
          throw new Error('Paced server response has no socket');
        }
        socketClosed = new Promise<void>((resolve) => {
          socket.on('close', () => {
            canceled = !completed;
            resolve();
          });
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
        getSocketClosed: () => {
          if (socketClosed === undefined) {
            throw new Error('Paced response socket did not start');
          }
          return socketClosed;
        },
      }));
    }

    it('cancels the fetch request on observed overflow (no Content-Length)', async () => {
      const { server, getState, getWriterDone, getSocketClosed } =
        await startPacedServer();

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
      await Promise.all([getWriterDone(), getSocketClosed()]);

      const state = getState();
      expect(state.canceled).toBe(true);
      expect(state.completed).toBe(false);
    });

    it('cancels the fetch request on valid over-limit Content-Length early rejection', async () => {
      const { server, getState, getWriterDone, getSocketClosed } =
        await startPacedServer({
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
      await Promise.all([getWriterDone(), getSocketClosed()]);

      const state = getState();
      expect(state.canceled).toBe(true);
      expect(state.completed).toBe(false);
    });

    it('cancels the fetch request on mid-read external abort through node-fetch', async () => {
      const { server, getState, getWriterDone, getSocketClosed } =
        await startPacedServer();

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
      await Promise.all([getWriterDone(), getSocketClosed()]);

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

    const observeInvokesCancelRequestAndReleasesListenersOnOverLimitContentLengthEarlyRejectAt282 =
      async () => {
        const fakeResponse: BoundedFetchResponse = {
          body: Readable.from([Buffer.from('x'.repeat(100))]),
          headers: {
            get: (name: string) =>
              name === 'content-length' ? '999999' : null,
          },
        };
        const tracker = createTrackingCancel();
        return { fakeResponse, tracker };
      };

    it('invokes cancelRequest and releases listeners on over-limit Content-Length early reject', async () => {
      const { fakeResponse, tracker } =
        await observeInvokesCancelRequestAndReleasesListenersOnOverLimitContentLengthEarlyRejectAt282();
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
          'close',
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

      expect(attachedListenerCount(body, 'data', 'end', 'error', 'close')).toBe(
        0,
      );
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

      expect(attachedListenerCount(body, 'data', 'end', 'error', 'close')).toBe(
        0,
      );
      expect(tracker.abortListenerCount).toBe(0);
    });

    const observeRemovesAllAdapterOwnedListenersAndTheAbortListenerAfterAbortAt457 =
      async () => {
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
        return { writerDone, tracker, body, promise };
      };

    it('removes all adapter-owned listeners and the abort listener after abort', async () => {
      const { writerDone, tracker, body, promise } =
        await observeRemovesAllAdapterOwnedListenersAndTheAbortListenerAfterAbortAt457();
      await expect(promise).rejects.toThrow(/abort/i);
      await writerDone;
      expect(attachedListenerCount(body, 'data', 'end', 'error', 'close')).toBe(
        0,
      );
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
          'close',
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
      expect(stream.destroyed).toBe(true);
      // No adapter-owned listeners remain on the body.
      expect(
        attachedListenerCount(
          stream as NodeJS.ReadableStream,
          'data',
          'end',
          'error',
          'close',
        ),
      ).toBe(0);
      expect(abortTracker.abortListenerCount).toBe(0);
    });
  });

  /**
   * A body that closes without emitting 'end' must not leave the acquisition
   * promise pending forever. The adapter must settle (reject) on the close
   * event, distinguish premature close from a clean end, and never double-settle
   * when 'error' or 'abort' precedes 'close'. These tests target that
   * authoritative-settlement behavior (issue #3202).
   */
  describe('acquireBoundedHttpBody — premature close settlement', () => {
    it('rejects when the body closes without end (no prior error)', async () => {
      const stream = new Readable({
        read() {
          this.push(Buffer.from('partial-body'));
          // Destroy without an error: emits 'close' but NOT 'end'.
          this.destroy();
        },
      });
      const fakeResponse: BoundedFetchResponse = {
        body: stream,
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
      ).rejects.toThrow(/closed|premature|incomplete/i);

      // Premature close cancels the request and cleans up all listeners.
      expect(tracker.called).toBe(true);
      expect(
        attachedListenerCount(
          stream as NodeJS.ReadableStream,
          'data',
          'end',
          'error',
          'close',
        ),
      ).toBe(0);
    });

    it('settles once with the read error when the stream errors then closes', async () => {
      const stream = new Readable({
        read() {
          this.destroy(new Error('socket reset'));
        },
      });
      const fakeResponse: BoundedFetchResponse = {
        body: stream,
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
      ).rejects.toThrow('socket reset');

      // The 'close' that follows 'error' must not mutate the settlement.
      expect(tracker.called).toBe(true);
      expect(
        attachedListenerCount(
          stream as NodeJS.ReadableStream,
          'data',
          'end',
          'error',
          'close',
        ),
      ).toBe(0);
    });

    it('settles once on abort then close and cleans up listeners', async () => {
      const stream = new Readable({
        read() {
          this.push(Buffer.from('x'.repeat(64)));
        },
      });
      const fakeResponse: BoundedFetchResponse = {
        body: stream,
        headers: { get: () => null },
      };
      const controller = new AbortController();
      const tracker = createTrackingCancel();

      const promise = acquireBoundedHttpBody(
        fakeResponse,
        createByteBudget(10 * 1024 * 1024),
        controller.signal,
        tracker.cancel,
      );
      controller.abort();

      await expect(promise).rejects.toThrow(/abort/i);
      expect(tracker.called).toBe(true);
      // The adapter destroys the body on abort; the trailing 'close' must not
      // double-settle. No listeners remain.
      expect(
        attachedListenerCount(
          stream as NodeJS.ReadableStream,
          'data',
          'end',
          'error',
          'close',
        ),
      ).toBe(0);
    });
  });
});
