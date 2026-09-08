/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { createByteBudget } from './index.js';
import {
  acquireBoundedHttpBody,
  disposeHttpResponseBody,
  HttpBodyTooLargeError,
  type BoundedFetchResponse,
} from './bounded-http-response.js';
import { createLoopbackHarness } from '../test-utils/loopback-test-helpers.js';

const loopback = createLoopbackHarness();

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

type DisposalOutcome =
  | { readonly state: 'settled'; readonly error: unknown }
  | { readonly state: 'pending' };

async function observePromptStatusError(
  response: BoundedFetchResponse,
  primaryError: Error,
): Promise<DisposalOutcome> {
  const statusFailure = (async (): Promise<unknown> => {
    try {
      await Promise.resolve(disposeHttpResponseBody(response, noopCancel));
      throw primaryError;
    } catch (error) {
      return error;
    }
  })();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutOutcome = new Promise<DisposalOutcome>((resolve) => {
    timeout = setTimeout(() => resolve({ state: 'pending' }), 100);
  });

  try {
    return await Promise.race([
      statusFailure.then(
        (error): DisposalOutcome => ({ state: 'settled', error }),
      ),
      timeoutOutcome,
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function settledDisposalError(outcome: DisposalOutcome): unknown {
  if (outcome.state !== 'settled') {
    throw new Error('Expected response disposal to return promptly');
  }
  return outcome.error;
}

describe('acquireBoundedHttpBody: under-budget streaming', () => {
  it('returns an empty result when the response body is null', async () => {
    const response: BoundedFetchResponse = {
      body: null,
      headers: new Headers(),
    };

    const body = await acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      new AbortController().signal,
      noopCancel,
    );

    expect(body.text).toBe('');
    expect(body.metadata.observedBytes).toBe(0);
    expect(body.metadata.truncated).toBe(false);
  });

  it('reads a real local chunked response under budget', async () => {
    const payload = 'x'.repeat(512);
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(payload);
    });

    const response = await fetch(loopback.serverUrl(server));
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
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      for (const frag of fragments) {
        res.write(frag);
      }
      res.end();
    });

    const response = await fetch(loopback.serverUrl(server));
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

describe('acquireBoundedHttpBody: overflow detection', () => {
  it('fails when a missing-Content-Length response exceeds the budget', async () => {
    const payload = 'x'.repeat(2048);
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write(payload);
      res.end();
    });

    const response = await fetch(loopback.serverUrl(server));
    const budget = createByteBudget(1024);

    await expect(
      acquireBoundedHttpBody(
        response,
        budget,
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
  });

  it('fails atomically when fragmented chunks are one byte over the budget', async () => {
    const payload = 'x'.repeat(1025);
    const fragments = fragmentPayload(payload, 3);
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      for (const frag of fragments) {
        res.write(frag);
      }
      res.end();
    });

    const response = await fetch(loopback.serverUrl(server));

    await expect(
      acquireBoundedHttpBody(
        response,
        createByteBudget(1024),
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
  });

  it('rejects an over-limit Content-Length before iteration', async () => {
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': '999999',
      });
      res.end('x'.repeat(999999));
    });

    const response = await fetch(loopback.serverUrl(server));
    const budget = createByteBudget(1024);

    await expect(
      acquireBoundedHttpBody(
        response,
        budget,
        new AbortController().signal,
        noopCancel,
      ),
    ).rejects.toBeInstanceOf(HttpBodyTooLargeError);
  });
});

describe('acquireBoundedHttpBody: exact byte boundary', () => {
  it('succeeds when body bytes exactly equal the budget', async () => {
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(1024));
    });

    const response = await fetch(loopback.serverUrl(server));
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
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('x'.repeat(1025));
      res.end();
    });

    const response = await fetch(loopback.serverUrl(server));

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
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.write(payload);
      res.end();
    });

    const response = await fetch(loopback.serverUrl(server));
    const body = await acquireBoundedHttpBody(
      response,
      createByteBudget(1024),
      new AbortController().signal,
      noopCancel,
    );

    expect(body.text).toBe(payload);
    expect(body.metadata.observedBytes).toBe(1024);
  });
});

describe('disposeHttpResponseBody', () => {
  it('cancels an unlocked native response body without relying on request cancellation', async () => {
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.write('unread error body');
    });
    const response = await fetch(loopback.serverUrl(server));
    let requestCancellationInvoked = false;

    const result = disposeHttpResponseBody(response, () => {
      requestCancellationInvoked = true;
    });

    expect(result).toBeUndefined();
    expect(requestCancellationInvoked).toBe(true);
    expect(response.bodyUsed).toBe(true);
  });

  it('preserves the caller primary error when request cancellation fails', async () => {
    const server = await loopback.startServer((_req, res) => {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.write('unread error body');
    });
    const response = await fetch(loopback.serverUrl(server));
    const primaryError = new Error('primary HTTP status failure');
    let observedError: unknown;

    try {
      disposeHttpResponseBody(response, () => {
        throw new Error('request cancellation failure');
      });
      throw primaryError;
    } catch (error) {
      observedError = error;
    }

    expect(observedError).toBe(primaryError);
    expect(response.bodyUsed).toBe(true);
  });

  it('returns promptly and preserves the primary status error when body cancellation rejects', async () => {
    let cancellationStarted = false;
    const response: BoundedFetchResponse = {
      body: new ReadableStream<Uint8Array>({
        cancel() {
          cancellationStarted = true;
          return Promise.reject(new Error('body cancellation rejected'));
        },
      }),
      headers: { get: () => null },
    };
    const primaryError = new Error('primary HTTP status failure');

    const outcome = await observePromptStatusError(response, primaryError);

    expect(settledDisposalError(outcome)).toBe(primaryError);
    expect(cancellationStarted).toBe(true);
  });

  it('returns promptly and preserves the primary status error when body cancellation never settles', async () => {
    let cancellationStarted = false;
    const response: BoundedFetchResponse = {
      body: new ReadableStream<Uint8Array>({
        cancel() {
          cancellationStarted = true;
          return new Promise<void>(() => {});
        },
      }),
      headers: { get: () => null },
    };
    const primaryError = new Error('primary HTTP status failure');

    const outcome = await observePromptStatusError(response, primaryError);

    expect(settledDisposalError(outcome)).toBe(primaryError);
    expect(cancellationStarted).toBe(true);
  });
});
