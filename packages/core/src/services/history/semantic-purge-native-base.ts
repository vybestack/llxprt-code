/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import { HistoryReaderScope } from './historyReaderScope.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import type { SemanticPurgeSnapshot } from './semantic-purge-native.js';

export class NativeSemanticPurgeBase {
  private readonly readers = new HistoryReaderScope(
    'Semantic media purge transaction is closed',
  );

  constructor(
    private readonly snapshot: SemanticPurgeSnapshot,
    private readonly ownership?: RowOwnership,
  ) {}

  view(): {
    readonly length: number;
    streamRows(signal?: AbortSignal): AsyncGenerator<IContent, void, unknown>;
  } {
    return Object.freeze({
      length: this.snapshot.length,
      streamRows: (
        signal?: AbortSignal,
      ): AsyncGenerator<IContent, void, unknown> =>
        this.readers.open(this.rows(signal)),
    });
  }

  private async *rows(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of this.snapshot.streamRows(signal)) {
      this.ownership?.retain(row);
      try {
        yield row;
      } finally {
        this.ownership?.release(row);
      }
    }
  }

  async close(): Promise<void> {
    const failures: unknown[] = [];
    for (const close of [
      () => this.readers.close(),
      () => this.snapshot.close(),
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw historyMutationFailure(failures[0], failures.slice(1));
  }
}
