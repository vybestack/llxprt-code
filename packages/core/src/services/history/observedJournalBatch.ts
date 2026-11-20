/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { releaseRead } from '../../journal/pinLease.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';

type ReaderFailure = { readonly error: unknown } | undefined;

async function closeBatchPass(
  cursor: AsyncGenerator<IContent, void, unknown> | undefined,
  failure: ReaderFailure,
  finished: (failure: ReaderFailure) => void,
): Promise<void> {
  try {
    if (cursor !== undefined)
      await releaseRead(
        {
          close: async () => {
            await cursor.return();
          },
        },
        failure,
      );
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    finished(failure);
  }
}

export class ObservedJournalBatch implements HistoryBatchRowSource {
  private readonly passes: Array<Promise<ReaderFailure>> = [];

  constructor(
    private readonly source: HistoryBatchRowSource,
    private readonly ownership: RowOwnership | undefined,
  ) {}

  get length(): number {
    return this.source.length;
  }

  async *rows(): AsyncGenerator<IContent, void, unknown> {
    let finished: (failure: ReaderFailure) => void = () => undefined;
    this.passes.push(
      new Promise<ReaderFailure>((resolve) => {
        finished = resolve;
      }),
    );
    let failure: ReaderFailure;
    let cursor: AsyncGenerator<IContent, void, unknown> | undefined;
    try {
      cursor = this.source.rows();
      for (
        let item = await cursor.next();
        item.done !== true;
        item = await cursor.next()
      ) {
        this.ownership?.retain(item.value);
        try {
          yield item.value;
        } finally {
          this.ownership?.release(item.value);
          item = { done: true, value: undefined };
        }
      }
    } catch (error) {
      failure = { error };
      throw error;
    } finally {
      try {
        await closeBatchPass(cursor, failure, finished);
      } finally {
        cursor = undefined;
      }
    }
  }

  async drain(): Promise<void> {
    let failure: ReaderFailure;
    for (let index = 0; index < this.passes.length; index++) {
      const result = await this.passes[index];
      failure ??= result;
    }
    if (failure !== undefined) throw failure.error;
  }

  retire(): void | Promise<void> {
    return this.source.retire();
  }
}
