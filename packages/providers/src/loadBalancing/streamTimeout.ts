/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251212issue489 - Phase 3
 * Stream timeout wrapping for load-balancer first-chunk timeouts.
 *
 * Since issue #2532 the timeout, exposure marking, and cleanup semantics live
 * in the single guarded-stream primitive shared with RetryOrchestrator. This
 * module keeps the load balancer's observable timeout surface (the typed
 * RequestTimeoutError, its log line, and isTimeoutError) while delegating
 * behavior to guardStream.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { guardStream } from '../guardedStream.js';
import type { RequestCommitState } from '../retryRequestContext.js';

const REQUEST_TIMEOUT_ERROR_CODE = 'LLXPRT_REQUEST_TIMEOUT';

export class RequestTimeoutError extends Error {
  readonly code = REQUEST_TIMEOUT_ERROR_CODE;

  constructor(readonly timeoutMs: number) {
    super(`Request timeout after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
  }
}

export async function* wrapWithTimeout(
  iterator: AsyncIterableIterator<IContent>,
  timeoutMs: number | undefined,
  profileName: string,
  logger: DebugLogger,
  attemptController: AbortController = new AbortController(),
  context?: RequestCommitState,
): AsyncGenerator<IContent> {
  try {
    yield* guardStream(iterator, {
      ...(timeoutMs !== undefined && timeoutMs > 0 ? { timeoutMs } : {}),
      attemptController,
      ...(context !== undefined ? { context } : {}),
      timeoutError: (ms) => new RequestTimeoutError(ms),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      logger.debug(
        () =>
          `[LB:timeout] ${profileName}: Request timed out after ${timeoutMs}ms`,
      );
    }
    throw error;
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
