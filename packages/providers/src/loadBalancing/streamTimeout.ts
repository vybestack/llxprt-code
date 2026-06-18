/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251212issue489 - Phase 3
 * Stream timeout wrapping for load-balancer first-chunk timeouts.
 * Extracted from LoadBalancingProvider.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

/**
 * Wrap an async iterator with a first-chunk timeout. After the first chunk
 * arrives the timeout is cleared and the remaining chunks stream without
 * timeout.
 */
export async function* wrapWithTimeout(
  iterator: AsyncIterableIterator<IContent>,
  timeoutMs: number | undefined,
  profileName: string,
  logger: DebugLogger,
): AsyncGenerator<IContent> {
  // Use explicit undefined check to avoid different-types-comparison
  if (timeoutMs === undefined || timeoutMs <= 0) {
    // Use for-await instead of yield* to ensure proper error propagation
    // yield* can have subtle issues with error propagation in async generators
    for await (const chunk of iterator) {
      yield chunk;
    }
    return;
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    // Race first chunk against timeout
    const iteratorResult = iterator.next();
    const firstResult = await Promise.race([iteratorResult, timeoutPromise]);

    // Got first chunk, clear timeout
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }

    if (firstResult.done !== true) {
      yield firstResult.value;
    }

    // Yield remaining chunks (no timeout after first chunk)
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
      yield chunk;
    }
  } catch (error) {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    logger.debug(
      () =>
        `[LB:timeout] ${profileName}: Request timed out after ${timeoutMs}ms`,
    );
    throw error;
  }
}

/**
 * Check if an error is a timeout error (message contains "Request timeout").
 */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Request timeout');
}
