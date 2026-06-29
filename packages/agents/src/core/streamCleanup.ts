/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentResponse } from '@google/genai';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';

const logger = new DebugLogger('llxprt:stream-cleanup');

type StreamResult = IteratorResult<GenerateContentResponse, void>;
type StreamNext<TNext> = (...args: [] | [TNext]) => Promise<StreamResult>;
type StreamReturn = (value?: void) => Promise<StreamResult>;
type StreamThrow = (error?: unknown) => Promise<StreamResult>;
type StreamAsyncDispose = () => Promise<void>;

function bindOptionalMethod<T>(
  target: object,
  key: PropertyKey,
): T | undefined {
  const candidate = (target as Record<PropertyKey, unknown>)[key];
  // This cast assumes the runtime method matches T's signature; callers must
  // request the expected iterator method type.
  return typeof candidate === 'function'
    ? (candidate.bind(target) as T)
    : undefined;
}

function createCleanup(
  provider: IProvider,
  compressionHandler: CompressionHandler,
  abortSignal: AbortSignal | undefined,
): () => void {
  let cleanupDone = false;
  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;
    try {
      abortSignal?.removeEventListener('abort', cleanup);
      compressionHandler.clearProviderCompressionCallback(provider);
    } catch {
      // Best-effort cleanup must not mask the original stream error.
    }
  };

  // If a caller never consumes or closes the wrapper, this listener remains
  // until the AbortSignal is aborted; callers must close abandoned streams.
  const isAlreadyAborted = abortSignal?.aborted ?? false;
  if (!isAlreadyAborted) {
    abortSignal?.addEventListener('abort', cleanup, { once: true });
  } else {
    // The provider stream is created by the caller after enforcement; cleanup
    // here only detaches the callback before any aborted stream consumption.
    cleanup();
  }
  return cleanup;
}

function cleanupWhenDone(
  result: StreamResult,
  cleanup: () => void,
): StreamResult {
  if (result.done === true) cleanup();
  return result;
}

function attachCauseToStreamError(streamError: unknown, cause: unknown): void {
  if (cause === undefined || streamError === cause) return;
  if (typeof streamError !== 'object' || streamError === null) return;
  const candidate = streamError as { cause?: unknown };
  if (candidate.cause !== undefined) return;
  try {
    candidate.cause = cause;
  } catch {
    // Best-effort only; thrown values may be non-extensible.
  }
}

async function returnWithCleanup(
  streamReturn: StreamReturn | undefined,
  cleanup: () => void,
  value?: void,
): Promise<StreamResult> {
  // If streamReturn is unavailable, cleanup clears the compression callback
  // but cannot close the underlying stream.
  try {
    const result = streamReturn
      ? await streamReturn(value)
      : { done: true as const, value: value as void };
    return cleanupWhenDone(result, cleanup);
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function throwWithCleanup(
  streamThrow: StreamThrow | undefined,
  streamReturn: StreamReturn | undefined,
  cleanup: () => void,
  error?: unknown,
): Promise<StreamResult> {
  if (streamThrow) {
    try {
      return cleanupWhenDone(await streamThrow(error), cleanup);
    } catch (streamError) {
      cleanup();
      attachCauseToStreamError(streamError, error);
      throw streamError;
    }
  }
  if (streamReturn) {
    try {
      await streamReturn();
    } catch (teardownError) {
      logger.debug(
        () =>
          '[streamCleanup] stream return failed while preserving throw error',
        teardownError,
      );
    }
  }
  cleanup();
  throw error ?? new Error('Stream cancelled via throw()');
}

async function disposeWithCleanup(
  streamAsyncDispose: StreamAsyncDispose | undefined,
  streamReturn: StreamReturn | undefined,
  cleanup: () => void,
): Promise<void> {
  if (streamAsyncDispose) {
    try {
      await streamAsyncDispose();
    } finally {
      cleanup();
    }
  } else {
    // If streamReturn is unavailable, cleanup can only clear the compression
    // callback; it cannot close the stream.
    try {
      if (streamReturn) {
        await streamReturn();
      }
    } catch (teardownError) {
      logger.debug(
        () => '[streamCleanup] stream return failed during async dispose',
        teardownError,
      );
    } finally {
      cleanup();
    }
  }
}

/**
 * Wraps a provider stream and clears the compression callback when the stream is
 * completed, closed, fails, or the request aborts. Callers must consume or close
 * the returned generator so cleanup can run for non-aborted requests.
 */
export function withCompressionCallbackCleanup<TNext = unknown>(
  stream: AsyncGenerator<GenerateContentResponse, void, TNext>,
  provider: IProvider,
  compressionHandler: CompressionHandler,
  abortSignal?: AbortSignal,
): AsyncGenerator<GenerateContentResponse, void, TNext> {
  const cleanup = createCleanup(provider, compressionHandler, abortSignal);
  const streamNext = bindOptionalMethod<StreamNext<TNext>>(stream, 'next');
  const streamReturn = bindOptionalMethod<StreamReturn>(stream, 'return');
  const streamThrow = bindOptionalMethod<StreamThrow>(stream, 'throw');
  const streamAsyncDispose = bindOptionalMethod<StreamAsyncDispose>(
    stream,
    Symbol.asyncDispose,
  );

  const wrapper = {
    async next(...args: [] | [TNext]): Promise<StreamResult> {
      if (!streamNext) {
        try {
          await streamReturn?.();
        } catch (teardownError) {
          logger.debug(
            () => '[streamCleanup] stream return failed on missing next()',
            teardownError,
          );
        }
        cleanup();
        throw new TypeError('Stream is missing the required next() method');
      }
      try {
        const result = await streamNext(...args);
        return cleanupWhenDone(result, cleanup);
      } catch (error) {
        cleanup();
        throw error;
      }
    },
    async return(value?: void): Promise<StreamResult> {
      return returnWithCleanup(streamReturn, cleanup, value);
    },
    async throw(error?: unknown): Promise<StreamResult> {
      return throwWithCleanup(streamThrow, streamReturn, cleanup, error);
    },
    [Symbol.asyncIterator]() {
      return wrapper as AsyncGenerator<GenerateContentResponse, void, TNext>;
    },
    [Symbol.asyncDispose]: () =>
      disposeWithCleanup(streamAsyncDispose, streamReturn, cleanup),
  };

  return wrapper as AsyncGenerator<GenerateContentResponse, void, TNext>;
}
