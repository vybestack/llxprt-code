/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';

type ReaderFailure = { readonly error: unknown } | undefined;

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
    try {
      for await (const row of this.source.rows()) {
        this.ownership?.retain(row);
        try {
          yield row;
        } finally {
          this.ownership?.release(row);
        }
      }
    } catch (error) {
      failure = { error };
      throw error;
    } finally {
      finished(failure);
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
