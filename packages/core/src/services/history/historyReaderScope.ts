/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

type Reader = AsyncGenerator<IContent, void, unknown>;

export class HistoryReaderScope {
  private closed = false;
  private closing: Promise<void> | undefined;
  private readonly readers = new Set<Reader>();
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

  open(source: Reader): Reader {
    const reader: Reader = {
      [Symbol.asyncIterator]: () => reader,
      async [Symbol.asyncDispose]() {
        await reader.return();
      },
      next: async (value) => {
        this.requireOpen();
        const result = await source.next(value);
        if (result.done === true) this.readers.delete(reader);
        this.requireOpen();
        return result;
      },
      return: async (value) => {
        try {
          return await source.return(value);
        } finally {
          this.readers.delete(reader);
        }
      },
      throw: async (error) => {
        try {
          return await source.throw(error);
        } finally {
          this.readers.delete(reader);
        }
      },
    };
    if (!this.closed) this.readers.add(reader);
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
