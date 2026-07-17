/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { markErrorAfterStreamOutput } from './retryErrorClassification.js';
import { closeIteratorBeforeContinuing } from './utils/streamCleanup.js';

/**
 * Wraps an async generator with a timeout for the first chunk.
 */
export async function* streamWithTimeout(
  stream: AsyncIterableIterator<IContent>,
  timeoutMs: number,
  attemptController: AbortController,
): AsyncGenerator<IContent, boolean> {
  const iterator = stream[Symbol.asyncIterator]();
  let firstChunk = true;
  let chunksYielded = false;
  let completed = false;
  let failed = false;
  let failure: unknown;

  try {
    for (;;) {
      if (attemptController.signal.aborted) {
        throw createAbortError(attemptController.signal.reason);
      }
      const nextPromise = iterator.next();
      const result = firstChunk
        ? await raceFirstChunkWithTimeout(nextPromise, timeoutMs)
        : await nextPromise;
      firstChunk = false;
      if (result.done === true) {
        completed = true;
        return chunksYielded;
      }
      chunksYielded = true;
      yield result.value;
    }
  } catch (error) {
    failed = true;
    const propagatedFailure = chunksYielded
      ? markErrorAfterStreamOutput(error)
      : error;
    failure = propagatedFailure;
    throw propagatedFailure;
  } finally {
    if (!completed) {
      attemptController.abort();
      await closeIteratorBeforeContinuing(iterator, failure, failed);
    }
  }
}

/**
 * Yield stream chunks without timeout, marking the error if chunks were
 * already yielded so the retry loop knows not to retry.
 */
export async function* yieldStreamUnprotected(
  stream: AsyncIterableIterator<IContent>,
  attemptController: AbortController,
  logger: { debug: (fn: () => string) => void },
): AsyncGenerator<IContent, boolean> {
  const iterator = stream[Symbol.asyncIterator]();
  let chunksYielded = false;
  let completed = false;
  let failed = false;
  let failure: unknown;
  try {
    for await (const chunk of iterator) {
      chunksYielded = true;
      yield chunk;
    }
    completed = true;
    return chunksYielded;
  } catch (streamError) {
    failed = true;
    failure = streamError;
    if (chunksYielded) {
      logger.debug(
        () =>
          `Error after yielding chunks - cannot retry (would produce mixed response)`,
      );
      throw markErrorAfterStreamOutput(streamError);
    }
    throw streamError;
  } finally {
    if (!completed) {
      attemptController.abort();
      await closeIteratorBeforeContinuing(iterator, failure, failed);
    }
  }
}

/**
 * Race the first stream chunk against a timeout. Resolves with the iterator
 * result (clearing the timeout), or rejects with a stream-timeout error.
 */
export async function raceFirstChunkWithTimeout<T>(
  nextPromise: Promise<IteratorResult<T>>,
  timeoutMs: number,
): Promise<IteratorResult<T>> {
  const timeoutController = new AbortController();
  try {
    const timeoutPromise = delay(timeoutMs, timeoutController.signal).then(
      () => {
        throw new Error(
          `Stream timeout: first chunk not received after ${timeoutMs}ms`,
        );
      },
    );
    return await Promise.race([nextPromise, timeoutPromise]);
  } finally {
    timeoutController.abort();
  }
}
