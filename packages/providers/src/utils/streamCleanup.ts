/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { StreamCleanupTimeoutError } from '../errors.js';

const STREAM_CLEANUP_TIMEOUT_MS = 1_000;

export async function closeIteratorBeforeContinuing<T>(
  iterator: AsyncIterator<T>,
  cause: unknown,
): Promise<void> {
  if (iterator.return === undefined) return;

  let timeoutId: NodeJS.Timeout | undefined;
  const cleanup = Promise.resolve(iterator.return())
    .then(() => 'closed' as const)
    .catch(() => 'closed' as const);
  const timeout = new Promise<'timeout'>((resolve) => {
    timeoutId = setTimeout(() => resolve('timeout'), STREAM_CLEANUP_TIMEOUT_MS);
  });
  try {
    if ((await Promise.race([cleanup, timeout])) === 'timeout') {
      throw new StreamCleanupTimeoutError(
        cause instanceof Error ? cause : new Error(String(cause)),
      );
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
