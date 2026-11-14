/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { responseArrivalFor } from './responseArrival.js';

export function cancellableResponseStream(
  source: AsyncGenerator<ModelStreamChunk>,
  process: () => AsyncGenerator<ModelStreamChunk>,
): AsyncGenerator<ModelStreamChunk> {
  let processed: AsyncGenerator<ModelStreamChunk> | undefined;
  const stream: AsyncGenerator<ModelStreamChunk> = {
    next: (value?: unknown) => {
      processed ??= process();
      return processed.next(value);
    },
    return: async (value?: unknown) => {
      if (processed !== undefined) return processed.return(value);
      try {
        await source.return(value);
      } finally {
        await responseArrivalFor(source)?.interrupt('cancelled');
      }
      return { done: true, value: undefined };
    },
    throw: async (error?: unknown) => {
      if (processed !== undefined) return processed.throw(error);
      try {
        await source.return(undefined);
      } finally {
        await responseArrivalFor(source)?.interrupt('error');
      }
      throw error;
    },
    async [Symbol.asyncDispose]() {
      await stream.return(undefined);
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  return stream;
}
