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
export async function* prependAsyncGenerator<T>(
  preloadedValue: T,
  source: AsyncIterator<T>,
): AsyncGenerator<T> {
  // Yield the preloaded value first
  yield preloadedValue;

  // Then delegate to the source iterator
  let result = await source.next();
  // We check done explicitly against true for type safety
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (result.done !== true) {
    yield result.value;
    result = await source.next();
  }
}
