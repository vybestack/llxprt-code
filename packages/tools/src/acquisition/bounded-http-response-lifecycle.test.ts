/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lifecycle tests for acquireBoundedHttpBody: cancellation, cancel-callback
 * invocation, abort registration edges, and settlement.
 * Split from bounded-http-response.test.ts to keep each file under the
 * source-size limit.
 *
 * @plan PLAN-20260810-ISSUE3202
 */

import type http from 'node:http';
import { describe, it, expect } from 'bun:test';
import { createByteBudget } from './index.js';
import {
  acquireBoundedHttpBody,
  HttpBodyTooLargeError,
  type BoundedFetchResponse,
} from './bounded-http-response.js';
import { createLoopbackHarness } from '../test-utils/loopback-test-helpers.js';

const loopback = createLoopbackHarness();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AcquisitionOutcome =
  | { readonly state: 'resolved' }
  | { readonly state: 'rejected'; readonly error: unknown }
  | { readonly state: 'pending' };

async function observePromptSettlement(
  acquisition: Promise<unknown>,
): Promise<AcquisitionOutcome> {
  return Promise.race([
    acquisition.then(
      (): AcquisitionOutcome => ({ state: 'resolved' }),
      (error: unknown): AcquisitionOutcome => ({ state: 'rejected', error }),
    ),
    delay(100).then<AcquisitionOutcome>(() => ({ state: 'pending' })),
  ]);
}

function rejectedError(outcome: AcquisitionOutcome): unknown {
  if (outcome.state !== 'rejected') {
    throw new Error(`Expected prompt rejection, observed ${outcome.state}`);
  }
  return outcome.error;
}

interface TrackingCancel {
  readonly cancel: () => void;
  readonly invocations: number;
}

function createTrackingCancel(cancelRequest?: () => void): TrackingCancel {
  let count = 0;
  return {
    cancel: () => {
      count++;
      cancelRequest?.();
    },
    get invocations() {
      return count;
    },
  };
}

function responseBody(
  response: BoundedFetchResponse,
): ReadableStream<Uint8Array> {
  if (response.body === null) {
    throw new Error('Expected a response body');
  }
  return response.body;
}

function expectReaderLockReleased(body: ReadableStream<Uint8Array>): void {
  const reader = body.getReader();
  reader.releaseLock();
}

function createTrackingController(): {
  readonly signal: AbortSignal;
  readonly abortListenerCount: number;
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

function syntheticResponse(
  body: ReadableStream<Uint8Array>,
  contentLength?: string,
): BoundedFetchResponse {
  return {
    body,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-length'
          ? (contentLength ?? null)
          : null,
    },
  };
}

describe('acquireBoundedHttpBody: native fetch response lifecycle', () => {
  function startPacedServer(options?: { contentLength?: number }): Promise<{
    readonly server: http.Server;
    readonly getState: () => { completed: boolean; canceled: boolean };
    readonly getWriterDone: () => Promise<void>;
    readonly getSocketClosed: () => Promise<void>;
  }> {
    let completed = false;
    let canceled = false;
    let writerDone: Promise<void> | undefined;
    let socketClosed: Promise<void> | undefined;
    const serverPromise = loopback.startServer((_req, res) => {
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
        socket.once('close', () => {
          canceled = !completed;
          resolve();
        });
      });

      const writer = (async (): Promise<void> => {
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
      })();
      loopback.trackWriter(writer);
      writerDone = writer;
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

  it('releases the reader lock without canceling transport after success', async () => {
    const server = await loopback.startServer((_req, res) => {
      res.end('complete body');
    });
    const response = await fetch(loopback.serverUrl(server));
    const tracker = createTrackingCancel();
    const abortTracker = createTrackingController();
    const body = responseBody(response);

    const result = await acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      abortTracker.signal,
      tracker.cancel,
    );

    expect(result.text).toBe('complete body');
    expect(tracker.invocations).toBe(0);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(body);
  });

  it('settles with AbortError for an already-aborted signal and cleans up once', async () => {
    const { server, getWriterDone, getSocketClosed } = await startPacedServer();
    const requestController = new AbortController();
    const response = await fetch(loopback.serverUrl(server), {
      signal: requestController.signal,
    });
    const body = responseBody(response);
    const abortTracker = createTrackingController();
    const tracker = createTrackingCancel(() => requestController.abort());
    abortTracker.abort();

    const acquisition = acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      abortTracker.signal,
      tracker.cancel,
    );

    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.all([getWriterDone(), getSocketClosed()]);
    expect(tracker.invocations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(body);
  });

  it('settles with AbortError for a mid-read abort and cleans up once', async () => {
    const { server, getState, getWriterDone, getSocketClosed } =
      await startPacedServer();
    const requestController = new AbortController();
    const response = await fetch(loopback.serverUrl(server), {
      signal: requestController.signal,
    });
    const body = responseBody(response);
    const abortTracker = createTrackingController();
    const tracker = createTrackingCancel(() => requestController.abort());

    const acquisition = acquireBoundedHttpBody(
      response,
      createByteBudget(10 * 1024 * 1024),
      abortTracker.signal,
      tracker.cancel,
    );
    abortTracker.abort();

    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.all([getWriterDone(), getSocketClosed()]);
    expect(tracker.invocations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(body);
    expect(getState()).toEqual({ completed: false, canceled: true });
  });

  it('settles with HttpBodyTooLargeError for observed overflow and cleans up once', async () => {
    const { server, getState, getWriterDone, getSocketClosed } =
      await startPacedServer();
    const requestController = new AbortController();
    const response = await fetch(loopback.serverUrl(server), {
      signal: requestController.signal,
    });
    const body = responseBody(response);
    const abortTracker = createTrackingController();
    const tracker = createTrackingCancel(() => requestController.abort());

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        abortTracker.signal,
        tracker.cancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
    await Promise.all([getWriterDone(), getSocketClosed()]);

    expect(tracker.invocations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(body);
    expect(getState()).toEqual({ completed: false, canceled: true });
  });

  it('settles with HttpBodyTooLargeError for declared overflow and cancels once', async () => {
    const { server, getState, getWriterDone, getSocketClosed } =
      await startPacedServer({ contentLength: 999999 });
    const requestController = new AbortController();
    const response = await fetch(loopback.serverUrl(server), {
      signal: requestController.signal,
    });
    const tracker = createTrackingCancel(() => requestController.abort());

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        tracker.cancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
    await Promise.all([getWriterDone(), getSocketClosed()]);

    expect(tracker.invocations).toBe(1);
    expect(getState()).toEqual({ completed: false, canceled: true });
  });

  it('keeps abort authoritative when buffered overflow races cancellation', async () => {
    const { server, getWriterDone, getSocketClosed } = await startPacedServer();
    const requestController = new AbortController();
    const response = await fetch(loopback.serverUrl(server), {
      signal: requestController.signal,
    });
    const body = responseBody(response);
    const abortTracker = createTrackingController();
    const tracker = createTrackingCancel(() => requestController.abort());

    const acquisition = acquireBoundedHttpBody(
      response,
      createByteBudget(8),
      abortTracker.signal,
      tracker.cancel,
    );
    abortTracker.abort();

    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.all([getWriterDone(), getSocketClosed()]);
    expect(tracker.invocations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(body);
  });
});

describe('acquireBoundedHttpBody: synthetic cleanup failures', () => {
  it('preserves an ordinary read error and releases the reader lock', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('stream read failure'));
      },
    });
    const response = syntheticResponse(stream);
    const tracker = createTrackingCancel();
    const abortTracker = createTrackingController();

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        abortTracker.signal,
        tracker.cancel,
      ),
    ).rejects.toThrow('stream read failure');

    expect(tracker.invocations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(stream);
  });

  it('keeps a read error authoritative when request cancellation throws', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('stream read failure'));
      },
    });
    const response = syntheticResponse(stream);
    const abortTracker = createTrackingController();
    let cancellations = 0;

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        abortTracker.signal,
        () => {
          cancellations++;
          throw new Error('request cancellation failed');
        },
      ),
    ).rejects.toThrow('stream read failure');

    expect(cancellations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(stream);
  });

  it('settles abort promptly and releases its reader when cancellation never settles', async () => {
    let streamCancellationStarted = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        streamCancellationStarted = true;
        return new Promise<void>(() => {});
      },
    });
    const response = syntheticResponse(stream);
    const tracker = createTrackingCancel();
    const abortTracker = createTrackingController();
    abortTracker.abort();

    const outcome = await observePromptSettlement(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        abortTracker.signal,
        tracker.cancel,
      ),
    );

    expect(rejectedError(outcome)).toMatchObject({ name: 'AbortError' });
    expect(streamCancellationStarted).toBe(true);
    expect(tracker.invocations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(stream);
  });

  it('keeps AbortError authoritative when already-aborted reader cancellation rejects', async () => {
    const cancelError = new Error('reader cancellation rejected');
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(cancelError);
      },
    });
    const response = syntheticResponse(stream);
    const tracker = createTrackingCancel();
    const abortTracker = createTrackingController();
    abortTracker.abort();

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        abortTracker.signal,
        tracker.cancel,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(tracker.invocations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(stream);
  });

  it('keeps AbortError authoritative when mid-flight reader cancellation rejects', async () => {
    const pullStarted = Promise.withResolvers<void>();
    const cancelError = new Error('reader cancellation rejected');
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        pullStarted.resolve();
      },
      cancel() {
        return Promise.reject(cancelError);
      },
    });
    const response = syntheticResponse(stream);
    const tracker = createTrackingCancel();
    const abortTracker = createTrackingController();
    const acquisition = acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      abortTracker.signal,
      tracker.cancel,
    );
    await pullStarted.promise;

    abortTracker.abort();

    await expect(acquisition).rejects.toMatchObject({ name: 'AbortError' });
    expect(tracker.invocations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(stream);
  });

  it('keeps observed overflow authoritative when reader cancellation rejects', async () => {
    const cancelError = new Error('reader cancellation rejected');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1025));
      },
      cancel() {
        return Promise.reject(cancelError);
      },
    });
    const response = syntheticResponse(stream);
    const tracker = createTrackingCancel();
    const abortTracker = createTrackingController();

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        abortTracker.signal,
        tracker.cancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);

    expect(tracker.invocations).toBe(1);
    expect(abortTracker.abortListenerCount).toBe(0);
    expectReaderLockReleased(stream);
  });

  it('keeps declared overflow authoritative when body cancellation rejects', async () => {
    const cancelError = new Error('body cancellation rejected');
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(cancelError);
      },
    });
    const response = syntheticResponse(stream, '2048');
    const tracker = createTrackingCancel();

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        tracker.cancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);

    expect(tracker.invocations).toBe(1);
    expectReaderLockReleased(stream);
  });

  it('settles declared overflow promptly without locking the body when cancellation never settles', async () => {
    let streamCancellationStarted = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        streamCancellationStarted = true;
        return new Promise<void>(() => {});
      },
    });
    const response = syntheticResponse(stream, '2048');
    const tracker = createTrackingCancel();

    const outcome = await observePromptSettlement(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        tracker.cancel,
      ),
    );

    expect(rejectedError(outcome)).toBeInstanceOf(HttpBodyTooLargeError);
    expect(streamCancellationStarted).toBe(true);
    expect(tracker.invocations).toBe(1);
    expect(stream.locked).toBe(false);
    expectReaderLockReleased(stream);
  });
});
