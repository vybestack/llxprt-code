/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { awaitOAuthOperation } from '../auth/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';

const logger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

export function abortError(cause?: unknown): DOMException {
  const error = new DOMException('MCP connection was cancelled', 'AbortError');
  if (cause !== undefined) {
    Object.defineProperty(error, 'cause', {
      configurable: true,
      enumerable: false,
      value: cause,
      writable: true,
    });
  }
  return error;
}

export function closeTransport(transport?: Transport): Promise<void> {
  return typeof transport?.close === 'function'
    ? transport.close()
    : Promise.resolve();
}

export async function closeAfterConnectionFailure(
  close: () => Promise<void>,
): Promise<void> {
  try {
    await close();
  } catch (error) {
    logger.warn('MCP transport cleanup failed:', error);
  }
}

export async function joinConnectionOperation<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  cleanup: (value: T) => void | Promise<void>,
  cleanupOnAbort?: () => void | Promise<void>,
): Promise<T> {
  let cleanupPromise: Promise<void> | undefined;
  const runCleanup = (operation: () => void | Promise<void>): Promise<void> => {
    cleanupPromise ??= closeAfterConnectionFailure(async () => {
      await operation();
    });
    return cleanupPromise;
  };
  const onAbort = (): void => {
    if (cleanupOnAbort) void runCleanup(cleanupOnAbort);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) onAbort();
  try {
    let value: T;
    try {
      value = await promise;
    } catch (error) {
      if (!signal.aborted) throw error;
      await cleanupPromise;
      throw abortError(error);
    }
    if (signal.aborted) {
      await runCleanup(() => cleanup(value));
      throw abortError();
    }
    return value;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export async function connectClient(
  client: Client,
  transport: Transport,
  timeout: number,
  signal?: AbortSignal,
): Promise<void> {
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => (closing ??= closeTransport(transport));
  try {
    signal?.throwIfAborted();
    const work = client.connect(transport, { timeout, signal });
    if (signal) await joinConnectionOperation(work, signal, close, close);
    else await work;
  } catch (error) {
    await closeAfterConnectionFailure(close);
    throw error;
  }
}

export function createJoiningTransport<T extends Transport>(
  create: (fetch: FetchLike) => T,
  signal?: AbortSignal,
): T {
  const controller = new AbortController();
  const lifetime = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  const pending = new Set<Promise<unknown>>();
  const streams = new Set<() => Promise<void>>();
  const track = <R>(operation: () => Promise<R>): Promise<R> => {
    const work = awaitOAuthOperation(lifetime, operation);
    pending.add(work);
    const remove = (): void => {
      pending.delete(work);
    };
    void work.then(remove, remove);
    return work;
  };
  const ownedFetch: FetchLike = (url, init) =>
    track(async () => {
      const requestSignal = init?.signal
        ? AbortSignal.any([lifetime, init.signal])
        : lifetime;
      const response = await fetch(url, { ...init, signal: requestSignal });
      if (requestSignal.aborted) {
        await response.body?.cancel();
        requestSignal.throwIfAborted();
      }
      trackEventStream(response, track, streams);
      return response;
    });
  const transport = create(ownedFetch);
  const start = transport.start.bind(transport);
  const send = transport.send.bind(transport);
  const close = transport.close.bind(transport);
  transport.start = () => awaitTransportStart(start, lifetime);
  const cancellationSends = new Set<Promise<void>>();
  let closed = false;
  transport.send = (...args) => {
    if (closed) return Promise.reject(new Error('MCP transport is closed'));
    const work = track(() => send(...args));
    const [message] = args;
    if ('method' in message && message.method === 'notifications/cancelled') {
      cancellationSends.add(work);
      const remove = (): void => {
        cancellationSends.delete(work);
      };
      void work.then(remove, remove);
    }
    return work;
  };
  let closing: Promise<void> | undefined;
  transport.close = () => {
    closed = true;
    closing ??= (async () => {
      const cancellations = await Promise.allSettled(cancellationSends);
      controller.abort();
      try {
        await close();
        const failures = cancellations.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (failures.length > 0)
          throw new AggregateError(
            failures,
            'MCP cancellation publication failed',
          );
      } finally {
        while (pending.size > 0) await Promise.allSettled([...pending]);
        await Promise.allSettled([...streams].map((cancel) => cancel()));
      }
    })();
    return closing;
  };
  return transport;
}

function awaitTransportStart(
  start: () => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  // The SDK SSE endpoint waiter does not settle on close. Join its I/O below.
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      signal.removeEventListener('abort', onAbort);
      onAbort();
      return;
    }
    void start().then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function trackEventStream(
  response: Response,
  track: <T>(operation: () => Promise<T>) => Promise<T>,
  streams: Set<() => Promise<void>>,
): void {
  const body = response.body;
  if (
    body &&
    response.headers.get('content-type')?.startsWith('text/event-stream') ===
      true
  ) {
    const reader = body.getReader();
    const cancel = async (): Promise<void> => {
      try {
        await reader.cancel();
      } finally {
        streams.delete(cancel);
      }
    };
    streams.add(cancel);
    Object.defineProperty(response, 'body', {
      value: new ReadableStream<Uint8Array>(
        {
          async pull(stream) {
            const result = await track(() => reader.read());
            if (result.done) {
              streams.delete(cancel);
              stream.close();
            } else stream.enqueue(result.value);
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    });
  }
}
