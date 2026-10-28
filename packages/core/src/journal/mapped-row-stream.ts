/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

export function mapRowStream<T, R>(
  rows: Iterable<T> | AsyncIterable<T>,
  map: (row: T) => R | Promise<R>,
): AsyncGenerator<R, void, unknown> {
  return new MappedRows(
    Symbol.asyncIterator in rows
      ? rows[Symbol.asyncIterator]()
      : rows[Symbol.iterator](),
    map,
  );
}

function finished(): IteratorReturnResult<void> {
  return { done: true, value: undefined };
}

class MappedRows<T, R> implements AsyncGenerator<R, void, unknown> {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private iterator: Iterator<T> | AsyncIterator<T> | undefined,
    private map: ((row: T) => R | Promise<R>) | undefined,
  ) {}

  [Symbol.asyncIterator](): AsyncGenerator<R, void, unknown> {
    return this;
  }

  private queue(
    operation: () => Promise<IteratorResult<R, void>>,
  ): Promise<IteratorResult<R, void>> {
    const result = this.tail.then(operation);
    // The queue owns completion only, never a fulfilled promise containing a row.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  next(): Promise<IteratorResult<R, void>> {
    return this.queue(() => this.pull());
  }

  private pull(): Promise<IteratorResult<R, void>> {
    const iterator = this.iterator;
    if (iterator === undefined) return Promise.resolve(finished());
    return Promise.resolve()
      .then(() => iterator.next())
      .then(
        (next): IteratorResult<R, void> | Promise<IteratorResult<R, void>> => {
          if (next.done === true) {
            this.iterator = undefined;
            this.map = undefined;
            return finished();
          }
          if (this.map === undefined) throw new Error('Row mapper is closed');
          return Promise.resolve(this.map(next.value)).then((value) => ({
            done: false,
            value,
          }));
        },
      )
      .catch((error: unknown) =>
        this.close().then(() => {
          throw error;
        }),
      );
  }

  private close(): Promise<IteratorReturnResult<void>> {
    const iterator = this.iterator;
    this.iterator = undefined;
    this.map = undefined;
    return Promise.resolve(iterator?.return?.()).then(finished);
  }

  return(value?: void | PromiseLike<void>): Promise<IteratorResult<R, void>> {
    return this.queue(() =>
      Promise.resolve(value).then(
        () => this.close(),
        (error: unknown) =>
          this.close().then(() => {
            throw error;
          }),
      ),
    );
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.return().then(() => undefined);
  }

  throw(error: unknown): Promise<IteratorResult<R, void>> {
    return this.queue(() =>
      this.close().then(() => {
        throw error;
      }),
    );
  }
}
