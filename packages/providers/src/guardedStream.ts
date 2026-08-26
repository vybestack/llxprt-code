/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createAbortError,
  delay,
} from '@vybestack/llxprt-code-core/utils/delay.js';
import { markErrorAfterStreamOutput } from './retryErrorClassification.js';
import {
  markRequestCommitted,
  type RetryRequestContext,
} from './retryRequestContext.js';
import type { StreamExposure } from './retryFailureTaxonomy.js';
import { raceWithAbort } from './utils/abortSignal.js';
import { closeIteratorBeforeContinuing } from './utils/streamCleanup.js';

export interface GuardedStreamOptions {
  readonly timeoutMs?: number;
  readonly attemptController: AbortController;
  readonly context: RetryRequestContext;
}

function exposureOf(content: Partial<IContent> | undefined): StreamExposure {
  const blocks = content?.blocks ?? [];
  if (blocks.some((block) => block.type === 'tool_call')) {
    return 'tool_call';
  }
  return blocks.length > 0 ? 'content' : 'metadata';
}

async function raceFirstChunkWithTimeout<T>(
  nextPromise: Promise<IteratorResult<T>>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  const timeoutController = new AbortController();
  try {
    const timeout = delay(timeoutMs, timeoutController.signal).then(() => {
      throw new Error(
        `Stream timeout: first chunk not received after ${timeoutMs}ms`,
      );
    });
    return await raceWithAbort(Promise.race([nextPromise, timeout]), signal);
  } finally {
    timeoutController.abort();
  }
}

/**
 * Guards streamed provider output with commitment, cancellation, and cleanup.
 *
 * Every emitted chunk counts as exposure. Chunks without blocks use metadata as
 * the exposure floor, including the invalid-but-defensively-handled case where
 * an adapter emits no metadata either.
 *
 * @param stream Provider stream to guard.
 * @param options Request context, attempt controller, and optional first-chunk timeout.
 * @returns Whether the stream emitted at least one chunk before completing.
 */
export async function* guardStream(
  stream: AsyncIterableIterator<IContent>,
  options: GuardedStreamOptions,
): AsyncGenerator<IContent, boolean> {
  const { attemptController, context, timeoutMs } = options;
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
      const result =
        firstChunk && timeoutMs !== undefined && timeoutMs > 0
          ? await raceFirstChunkWithTimeout(
              nextPromise,
              timeoutMs,
              attemptController.signal,
            )
          : await nextPromise;
      if (result.done === true) {
        // A stream that completes without content on its FIRST next() is a
        // normal empty stream, not a failure: leave it uncommitted and do not
        // close it. No chunk could have escaped before this point.
        completed = true;
        return chunksYielded;
      }
      firstChunk = false;
      chunksYielded = true;
      markRequestCommitted(context, exposureOf(result.value));
      yield result.value;
    }
  } catch (error) {
    failed = true;
    // A failure raised while still waiting on (or racing) the FIRST next() can
    // never follow a yielded chunk, so it stays retryable; only errors after
    // an outward yield are marked terminal.
    const propagatedFailure = firstChunk
      ? error
      : markErrorAfterStreamOutput(error);
    failure = propagatedFailure;
    throw propagatedFailure;
  } finally {
    if (!completed) {
      attemptController.abort();
      await closeIteratorBeforeContinuing(iterator, failure, failed);
    }
  }
}
