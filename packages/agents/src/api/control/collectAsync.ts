/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Materializes an async sequence into an array for one explicit caller
 * request (for example an export-style API that returns a full history).
 * Never use it on the send path or to retain rows between turns.
 */
export async function collectAsync<T>(
  source: AsyncIterable<T>,
): Promise<readonly T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}
