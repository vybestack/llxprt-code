/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const ITERATOR_CLEANUP_TIMEOUT_MS = 1_000;

export async function closeIteratorBounded<T>(
  iterator: AsyncIterator<T> | undefined,
): Promise<void> {
  if (iterator?.return === undefined) return;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let cleanup: Promise<unknown>;
  try {
    cleanup = Promise.resolve(iterator.return());
  } catch {
    return;
  }
  const settledCleanup = cleanup.catch(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, ITERATOR_CLEANUP_TIMEOUT_MS);
  });
  try {
    await Promise.race([settledCleanup, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
