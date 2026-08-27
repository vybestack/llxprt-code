/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ByteBudget, TruncationMetadata } from './types.js';
import { BoundedStreamCollector } from './boundedStreamCollector.js';

/** Structural surface of a native fetch Response used by bounded acquisition. */
export interface BoundedFetchResponse {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly headers: { get(name: string): string | null };
}

/** Thrown when an HTTP response body exceeds the configured byte budget. */
export class HttpBodyTooLargeError extends Error {
  readonly observedBytes: number;
  readonly budgetBytes: number;

  constructor(observedBytes: number, budgetBytes: number) {
    super(
      `Response body size (${observedBytes.toLocaleString('en-US')} bytes) exceeds the configured maximum (${budgetBytes.toLocaleString('en-US')} bytes)`,
    );
    this.name = 'HttpBodyTooLargeError';
    this.observedBytes = observedBytes;
    this.budgetBytes = budgetBytes;
  }
}

/** Result of bounded HTTP body acquisition. */
export interface BoundedHttpBody {
  readonly text: string;
  readonly metadata: TruncationMetadata;
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Parse a Content-Length header strictly. Only when the entire trimmed value
 * consists solely of decimal digits and is safely representable as a nonnegative
 * integer is it accepted. Malformed or unsafe values are treated as absent,
 * forcing observed-byte streaming enforcement.
 */
function parseContentLength(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

/**
 * Close/cancel a native fetch response body without reading it. Used by callers
 * that reject a response before body acquisition (e.g. non-2xx status).
 *
 * The body is canceled directly, then the caller-owned callback aborts the
 * concrete fetch request. Cleanup failures are ignored so the caller's primary
 * HTTP status error remains authoritative and the helper stays synchronous.
 */
export function disposeHttpResponseBody(
  response: BoundedFetchResponse,
  cancelRequest: () => void,
): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Cleanup must not replace the caller's primary HTTP status error.
  }
  attemptRequestCancellation(cancelRequest);
}

function createReaderRelease(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): () => void {
  let released = false;
  return (): void => {
    if (released) return;
    released = true;
    reader.releaseLock();
  };
}

function attemptRequestCancellation(cancelRequest: () => void): void {
  try {
    cancelRequest();
  } catch {
    return;
  }
}

/**
 * Read a native {@link ReadableStream} through a {@link BoundedStreamCollector}
 * configured to retain the complete bounded response.
 *
 * The body is consumed chunk-by-chunk via a Web Stream reader. Bytes are counted
 * in one pass and decoded only when the complete body fits the budget. Overflow
 * and abort cancel the locked reader and concrete request. A read error
 * cancels the request directly because the stream is already errored. Every path
 * releases the reader lock and removes the abort listener. Normal completion does
 * not cancel the request.
 */
function streamBoundedBody(
  body: ReadableStream<Uint8Array>,
  budget: ByteBudget,
  signal: AbortSignal,
  cancelRequest: () => void,
): Promise<BoundedHttpBody> {
  const reader = body.getReader();
  const releaseReader = createReaderRelease(reader);
  const collector = new BoundedStreamCollector({ budget, headFraction: 1 });
  let settled = false;
  let cancellationStarted = false;

  const cancelAcquisition = (): void => {
    if (cancellationStarted) return;
    cancellationStarted = true;
    attemptRequestCancellation(cancelRequest);
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      // Cleanup must not replace the authoritative acquisition error.
    }
    releaseReader();
  };

  return new Promise<BoundedHttpBody>((resolve, reject) => {
    const rejectAfterCancellation = (error: unknown): void => {
      cancelAcquisition();
      reject(error);
    };

    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      action();
    };

    const onAbort = (): void => {
      settle(() => {
        rejectAfterCancellation(createAbortError());
      });
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    void (async () => {
      try {
        while (!settled) {
          const { done, value } = await reader.read();
          if (signal.aborted) return;
          if (done) {
            settle(() => {
              const result = collector.getResult();
              resolve({ text: result.text, metadata: result.metadata });
            });
            return;
          }
          collector.append(Buffer.from(value));
          if (collector.observedByteCount > budget.bytes) {
            const observedBytes = collector.observedByteCount;
            settle(() => {
              rejectAfterCancellation(
                new HttpBodyTooLargeError(observedBytes, budget.bytes),
              );
            });
            return;
          }
        }
      } catch (readError) {
        settle(() => {
          attemptRequestCancellation(cancelRequest);
          reject(readError);
        });
      } finally {
        releaseReader();
      }
    })();
  });
}

function attemptUnlockedBodyCancellation(
  body: ReadableStream<Uint8Array> | null,
  cancelRequest: () => void,
): void {
  attemptRequestCancellation(cancelRequest);
  try {
    void body?.cancel().catch(() => undefined);
  } catch {
    // Cleanup must not replace the authoritative acquisition error.
  }
}

/**
 * Stream an HTTP response body through a bounded byte budget.
 *
 * The body is consumed chunk-by-chunk via a native Web Stream reader and retained
 * by a {@link BoundedStreamCollector} configured to retain the complete bounded
 * response (headFraction 1). Content-Length is used only as an early-reject
 * optimization; the actual streamed bytes are authoritative.
 *
 * Overflow and abort cancel the body through the locked reader and invoke the
 * caller-owned {@link cancelRequest} callback. Read errors invoke the callback
 * directly because the stream is already errored. All failure paths release the
 * reader lock, remove the abort listener, and return no partial body text. Normal
 * completion does not cancel the request.
 */
export async function acquireBoundedHttpBody(
  response: BoundedFetchResponse,
  budget: ByteBudget,
  signal: AbortSignal,
  cancelRequest: () => void,
): Promise<BoundedHttpBody> {
  const advertised = parseContentLength(response.headers.get('content-length'));
  if (advertised !== undefined && advertised > budget.bytes) {
    const overflowError = new HttpBodyTooLargeError(advertised, budget.bytes);
    attemptUnlockedBodyCancellation(response.body, cancelRequest);
    throw overflowError;
  }

  const body = response.body;
  if (body === null) {
    return Promise.resolve({
      text: '',
      metadata: {
        observedBytes: 0,
        retainedBytes: 0,
        omittedBytes: 0,
        truncated: false,
        budgetBytes: budget.bytes,
      },
    });
  }

  return streamBoundedBody(body, budget, signal, cancelRequest);
}
