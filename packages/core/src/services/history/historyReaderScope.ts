/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
type Reader<T> = AsyncGenerator<T, void, unknown>;

export class HistoryReaderScope {
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly readers = new Set<Reader<unknown>>();
  private readonly queries = new Set<Promise<unknown>>();

  constructor(private readonly closedMessage: string) {}

  requireOpen(): void {
    if (this.closed) throw new Error(this.closedMessage);
  }

  async read<T>(consume: () => T | Promise<T>): Promise<T> {
    this.requireOpen();
    const query = Promise.resolve().then(consume);
    this.queries.add(query);
    try {
      const value = await query;
      this.requireOpen();
      return value;
    } finally {
      this.queries.delete(query);
    }
  }

  open<T>(source: Reader<T>): Reader<T> {
    this.requireOpen();
    let active: Reader<T> | undefined = source;
    const reader: Reader<T> = {
      [Symbol.asyncIterator]: () => reader,
      async [Symbol.asyncDispose]() {
        await reader.return();
      },
      next: async (value) => {
        this.requireOpen();
        if (active === undefined) return { done: true, value: undefined };
        const result = await active.next(value);
        if (result.done === true) {
          active = undefined;
          this.readers.delete(reader);
        }
        this.requireOpen();
        return result;
      },
      return: async (value) => {
        const closing = active;
        active = undefined;
        try {
          if (closing === undefined) return { done: true, value: await value };
          const result = await closing.return(value);
          if (result.done !== true) active = closing;
          return result;
        } finally {
          this.readers.delete(reader);
        }
      },
      throw: async (error) => {
        const closing = active;
        active = undefined;
        try {
          if (closing === undefined) throw error;
          const result = await closing.throw(error);
          if (result.done !== true) active = closing;
          return result;
        } finally {
          this.readers.delete(reader);
        }
      },
    };
    this.readers.add(reader);
    return reader;
  }

  close(): Promise<void> {
    this.closed = true;
    this.closing ??= this.retire();
    return this.closing;
  }

  private async retire(): Promise<void> {
    await Promise.allSettled(this.queries);
    const failures: unknown[] = [];
    for (const reader of this.readers) {
      try {
        await reader.return();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'History reader cleanup failed');
  }
}
