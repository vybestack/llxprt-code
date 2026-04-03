/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility functions for working with async iterators/generators.
 * @issue #1750 - Stream retry boundary fix
 */

/**
 * Creates a new async generator that yields a preloaded value first,
 * then delegates to the remaining iterator.
 *
 * This is used to ensure the first chunk of a stream is consumed within
 * the retry boundary - establishing the HTTP connection inside the
 * retryWithBackoff boundary so connection errors trigger retry logic.
 *
 * @template T The type of values yielded by the iterators
 * @param preloadedValue The first value to yield
 * @param source The source async iterator to delegate remaining values from
 * @returns A new async generator that yields preloadedValue first, then delegates to source
 *
 * @example
 * ```typescript
 * async function* source() {
 *   yield 'second';
 *   yield 'third';
 * }
 *
 * const wrapped = prependAsyncGenerator('first', source());
 * // yields: 'first', 'second', 'third'
 * ```
 */
export function prependAsyncGenerator<T>(
  preloadedValue: T,
  source: AsyncIterator<T>,
): AsyncGenerator<T> {
  let preloadedPending = true;
  let sourceExhausted = false;
  let terminated = false;

  const prefixedIterator: AsyncGenerator<T> = {
    async next(value?: unknown): Promise<IteratorResult<T>> {
      if (terminated) {
        return { done: true, value: undefined };
      }

      if (preloadedPending) {
        preloadedPending = false;
        return { done: false, value: preloadedValue };
      }

      const result = await source.next(value);
      if (result.done === true) {
        sourceExhausted = true;
      }
      return result;
    },

    async return(value?: unknown): Promise<IteratorResult<T>> {
      if (terminated) {
        return { done: true, value: undefined };
      }

      terminated = true;
      if (!sourceExhausted && typeof source.return === 'function') {
        return source.return(value);
      }
      return { done: true, value: undefined };
    },

    async throw(error?: unknown): Promise<IteratorResult<T>> {
      terminated = true;

      if (typeof source.throw === 'function') {
        return source.throw(error);
      }

      if (!sourceExhausted && typeof source.return === 'function') {
        await source.return();
      }

      throw error;
    },

    [Symbol.asyncIterator](): AsyncGenerator<T> {
      return this;
    },

    async [Symbol.asyncDispose](): Promise<void> {
      await this.return(undefined);
    },
  };

  return prefixedIterator;
}
