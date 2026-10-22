/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

export function mapRowStream<T, R>(
  rows: Iterable<T> | AsyncIterable<T>,
  map: (row: T) => R | Promise<R>,
): AsyncGenerator<R> {
  return mappedRows(
    Symbol.asyncIterator in rows
      ? rows[Symbol.asyncIterator]()
      : rows[Symbol.iterator](),
    map,
  );
}

async function* mappedRows<T, R>(
  iterator: Iterator<T> | AsyncIterator<T> | undefined,
  map: (row: T) => R | Promise<R>,
): AsyncGenerator<R> {
  let next: IteratorResult<T> | undefined;
  let done = false;
  try {
    while (iterator !== undefined) {
      next = await iterator.next();
      if (next.done === true) {
        done = true;
        return;
      }
      const mapped = await map(next.value);
      next = undefined;
      yield mapped;
    }
  } finally {
    next = undefined;
    try {
      if (!done) await iterator?.return?.();
    } finally {
      iterator = undefined;
    }
  }
}
