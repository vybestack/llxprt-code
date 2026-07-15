/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251212issue489 - Phase 3
 * Stream timeout wrapping for load-balancer first-chunk timeouts.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { raceWithAbort } from '../utils/abortSignal.js';
import { closeIteratorBeforeContinuing } from '../utils/streamCleanup.js';

export interface AttemptCancellation {
  readonly signal: AbortSignal;
  cancel(): void;
}

const REQUEST_TIMEOUT_ERROR_CODE = 'LLXPRT_REQUEST_TIMEOUT';

export class RequestTimeoutError extends Error {
  readonly code = REQUEST_TIMEOUT_ERROR_CODE;

  constructor(readonly timeoutMs: number) {
    super(`Request timeout after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
  }
}

function createAttemptCancellation(): AttemptCancellation {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    cancel: () => controller.abort(),
  };
}

async function waitForFirstChunk(
  iterator: AsyncIterableIterator<IContent>,
  timeoutMs: number | undefined,
  signal: AbortSignal,
): Promise<IteratorResult<IContent>> {
  const next = iterator.next();
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return raceWithAbort(next, signal);
  }
  const waitController = new AbortController();
  try {
    const timeout = delay(timeoutMs, waitController.signal).then(() => {
      throw new RequestTimeoutError(timeoutMs);
    });
    return await raceWithAbort(Promise.race([next, timeout]), signal);
  } finally {
    waitController.abort();
  }
}

export async function* wrapWithTimeout(
  iterator: AsyncIterableIterator<IContent>,
  timeoutMs: number | undefined,
  profileName: string,
  logger: DebugLogger,
  attemptCancellation: AttemptCancellation = createAttemptCancellation(),
): AsyncGenerator<IContent> {
  let completed = false;
  let failed = false;
  let failure: unknown;
  try {
    const firstResult = await waitForFirstChunk(
      iterator,
      timeoutMs,
      attemptCancellation.signal,
    );
    if (firstResult.done !== true) yield firstResult.value;
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
      yield chunk;
    }
    completed = true;
  } catch (error) {
    failed = true;
    failure = error;
    if (isTimeoutError(error)) {
      logger.debug(
        () =>
          `[LB:timeout] ${profileName}: Request timed out after ${timeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    if (!completed) {
      let cancellationFailure: unknown;
      try {
        attemptCancellation.cancel();
      } catch (error) {
        cancellationFailure = error;
      }
      await closeIteratorBeforeContinuing(
        iterator,
        failed ? failure : cancellationFailure,
        failed || cancellationFailure !== undefined,
      );
    }
  }
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof RequestTimeoutError) return true;
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === REQUEST_TIMEOUT_ERROR_CODE
  ) {
    return true;
  }
  return error instanceof Error && error.message.includes('Request timeout');
}
