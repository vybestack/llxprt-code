/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const ITERATOR_CLEANUP_TIMEOUT_MS = 1_000;

export async function closeIteratorBounded<T>(
  iterator: AsyncIterator<T> | undefined,
  abortSignal?: AbortSignal,
  cleanupTimeoutMs = ITERATOR_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  if (iterator?.return === undefined) return;

  let cleanup: Promise<unknown>;
  try {
    cleanup = Promise.resolve(iterator.return());
  } catch {
    return;
  }
  const settledCleanup = cleanup.catch(() => undefined);
  if (abortSignal?.aborted === true) return;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const aborted =
    abortSignal === undefined
      ? undefined
      : new Promise<void>((resolve) => {
          onAbort = resolve;
          abortSignal.addEventListener('abort', onAbort, { once: true });
        });
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(resolve, cleanupTimeoutMs);
  });
  try {
    await Promise.race(
      aborted === undefined
        ? [settledCleanup, timeout]
        : [settledCleanup, timeout, aborted],
    );
  } finally {
    if (onAbort !== undefined) {
      abortSignal?.removeEventListener('abort', onAbort);
    }
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
