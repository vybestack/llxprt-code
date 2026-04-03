/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { delay } from './delay.js';

export class StreamIdleTimeoutError extends Error {
  constructor(message = 'Stream idle timeout') {
    super(message);
    this.name = 'StreamIdleTimeoutError';
  }
}

export interface NextStreamEventWithIdleTimeoutOptions<T> {
  iterator: AsyncIterator<T>;
  timeoutMs: number;
  signal?: AbortSignal;
  onTimeout?: () => void | Promise<void>;
  createTimeoutError?: () => Error;
}

export async function nextStreamEventWithIdleTimeout<T>({
  iterator,
  timeoutMs,
  signal,
  onTimeout,
  createTimeoutError = () => new StreamIdleTimeoutError(),
}: NextStreamEventWithIdleTimeoutOptions<T>): Promise<IteratorResult<T>> {
  const timeoutController = new AbortController();
  const onAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    signal.removeEventListener('abort', onAbort);
    await onTimeout?.();
    throw createTimeoutError();
  }

  try {
    const timeoutPromise = delay(timeoutMs, timeoutController.signal).then(
      async () => {
        await onTimeout?.();
        throw createTimeoutError();
      },
    );

    return await Promise.race([iterator.next(), timeoutPromise]);
  } finally {
    timeoutController.abort();
    signal?.removeEventListener('abort', onAbort);
  }
}
