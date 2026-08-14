/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ByteBudget, TruncationMetadata } from './types.js';
import { BoundedStreamCollector } from './boundedStreamCollector.js';

/** Minimal structural interface satisfied by a node-fetch Response. */
export interface BoundedFetchResponse {
  readonly body: NodeJS.ReadableStream | null;
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

type ManagedStream = NodeJS.ReadableStream & {
  destroyed?: boolean;
  destroy?(error?: Error): unknown;
};

function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function destroyStream(stream: ManagedStream | null | undefined): void {
  if (stream === null || stream === undefined) return;
  if (stream.destroyed === true) return;
  stream.destroy?.();
}

/**
 * Parse a Content-Length header strictly. Only when the entire trimmed value
 * consists solely of decimal digits and is safely representable as a
 * nonnegative integer is it accepted. Malformed or unsafe values are treated
 * as absent, forcing observed-byte streaming enforcement.
 */
function parseContentLength(header: string | null): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0 || !/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  // Node.js streams may emit strings; encode via UTF-8.
  return Buffer.from(String(chunk));
}

/**
 * Close/destroy a response body without reading it. Used by callers that
 * reject a response before body acquisition (e.g. non-2xx status).
 *
 * Both cancels the concrete HTTP request (via the caller-owned callback) and
 * destroys the response body wrapper so the underlying socket is released.
 */
export function disposeHttpResponseBody(
  response: BoundedFetchResponse,
  cancelRequest: () => void,
): void {
  cancelRequest();
  destroyStream(response.body as ManagedStream | null | undefined);
}

/**
 * Read a managed stream through a {@link BoundedStreamCollector} configured to
 * retain the complete bounded response.
 *
 * On overflow, abort, or read error the caller-owned {@link cancelRequest}
 * callback is invoked (cancelling the concrete HTTP request), the stream
 * wrapper is destroyed, and all listeners are removed. Normal completion does
 * not cancel the request.
 */
function streamBoundedBody(
  body: ManagedStream,
  budget: ByteBudget,
  signal: AbortSignal,
  cancelRequest: () => void,
): Promise<BoundedHttpBody> {
  return new Promise<BoundedHttpBody>((resolve, reject) => {
    const collector = new BoundedStreamCollector({ budget, headFraction: 1 });
    let settled = false;

    const cleanup = (): void => {
      body.removeListener('data', onData);
      body.removeListener('end', onEnd);
      body.removeListener('error', onError);
      body.removeListener('close', onClose);
      signal.removeEventListener('abort', onAbort);
    };

    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };

    const onData = (chunk: unknown): void => {
      collector.append(toBuffer(chunk));
      if (collector.observedByteCount > budget.bytes) {
        const overflowBytes = collector.observedByteCount;
        settle(() => {
          cancelRequest();
          destroyStream(body);
          reject(new HttpBodyTooLargeError(overflowBytes, budget.bytes));
        });
      }
    };

    const onEnd = (): void => {
      settle(() => {
        const result = collector.getResult();
        resolve({ text: result.text, metadata: result.metadata });
      });
    };

    const onError = (err: Error): void => {
      settle(() => {
        cancelRequest();
        destroyStream(body);
        reject(err);
      });
    };

    /**
     * 'close' without a prior 'end' means the body terminated prematurely —
     * the complete bounded body cannot be known, so acquisition settles by
     * rejecting. When 'end', 'error', or 'abort' settled first, this is a
     * guarded no-op (single authoritative settlement).
     */
    const onClose = (): void => {
      settle(() => {
        cancelRequest();
        destroyStream(body);
        reject(new Error('Response body closed before end (incomplete body)'));
      });
    };

    const onAbort = (): void => {
      settle(() => {
        cancelRequest();
        destroyStream(body);
        reject(createAbortError());
      });
    };

    body.on('error', onError);
    body.on('end', onEnd);
    body.on('close', onClose);
    body.on('data', onData);
    signal.addEventListener('abort', onAbort, { once: true });

    // Check for abort after listener registration to avoid the race where
    // the signal fires between a pre-registration check and addEventListener.
    if (signal.aborted) {
      onAbort();
    }
  });
}

/**
 * Stream an HTTP response body through a bounded byte budget.
 *
 * The body is consumed chunk-by-chunk via stream events and retained by a
 * {@link BoundedStreamCollector} configured to retain the complete bounded
 * response (headFraction 1). Content-Length is used only as an early-reject
 * optimization — the actual streamed bytes are authoritative.
 *
 * On overflow, abort, or read error the caller-owned {@link cancelRequest}
 * callback is invoked (cancelling the concrete HTTP request), the underlying
 * stream wrapper is destroyed, all listeners are removed, and the function
 * rejects. No partial body text is returned in the failure paths. Normal
 * completion does not cancel the request.
 *
 * @param cancelRequest Caller-owned cancellation of the concrete fetch request
 *   (e.g. aborting a per-fetch AbortController). Required so forgetting
 *   transport ownership is a compile error.
 */
export async function acquireBoundedHttpBody(
  response: BoundedFetchResponse,
  budget: ByteBudget,
  signal: AbortSignal,
  cancelRequest: () => void,
): Promise<BoundedHttpBody> {
  const advertised = parseContentLength(response.headers.get('content-length'));
  if (advertised !== undefined && advertised > budget.bytes) {
    cancelRequest();
    destroyStream(response.body as ManagedStream | null | undefined);
    throw new HttpBodyTooLargeError(advertised, budget.bytes);
  }

  const body = response.body as ManagedStream | null | undefined;
  if (body === null || body === undefined) {
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
