/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

/**
 * Wraps a provider stream so it is processed lazily, on first pull. Until
 * then cancellation closes the provider stream directly; afterwards it closes
 * the processed stream, which owns the provider stream's cleanup.
 */
export function createCancellableStream(
  streamResponse: AsyncGenerator<ModelStreamChunk>,
  startProcessing: () => AsyncGenerator<ModelStreamChunk>,
): AsyncGenerator<ModelStreamChunk> {
  let processedStream: AsyncGenerator<ModelStreamChunk> | undefined;
  const ensureProcessedStream = (): AsyncGenerator<ModelStreamChunk> => {
    processedStream ??= startProcessing();
    return processedStream;
  };

  const cancellableStream = {
    async next(value?: unknown): Promise<IteratorResult<ModelStreamChunk>> {
      return ensureProcessedStream().next(value);
    },
    async return(value?: unknown): Promise<IteratorResult<ModelStreamChunk>> {
      if (processedStream) {
        return typeof processedStream.return === 'function'
          ? processedStream.return(value)
          : { done: true, value: undefined };
      }

      if (typeof streamResponse.return === 'function') {
        await streamResponse.return(value);
      }

      return { done: true, value: undefined };
    },
    async throw(error?: unknown): Promise<IteratorResult<ModelStreamChunk>> {
      if (processedStream) {
        if (typeof processedStream.throw === 'function') {
          return processedStream.throw(error);
        }
        throw error;
      }

      if (typeof streamResponse.throw === 'function') {
        return streamResponse.throw(error);
      }

      if (typeof streamResponse.return === 'function') {
        await streamResponse.return(undefined);
      }

      throw error;
    },
    [Symbol.asyncIterator](): AsyncGenerator<ModelStreamChunk> {
      return this as AsyncGenerator<ModelStreamChunk>;
    },
  };

  return cancellableStream as AsyncGenerator<ModelStreamChunk>;
}
