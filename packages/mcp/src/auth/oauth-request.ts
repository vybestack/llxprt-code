/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Joins external work even when it does not support cancellation. */
export async function awaitOAuthOperation<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  let result: T;
  try {
    result = await operation();
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
  signal?.throwIfAborted();
  return result;
}
