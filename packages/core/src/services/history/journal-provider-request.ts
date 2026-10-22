/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { JournalRequestProjection } from './journal-request-projection.js';
import type { IContent } from './IContent.js';
import { HistoryReaderScope } from './historyReaderScope.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import type { ProviderRequestSnapshot } from './provider-request-snapshot.js';
import type { ProviderCuratedStreamOptions } from './provider-curated-stream.js';

export class JournalProviderRequestSnapshot implements ProviderRequestSnapshot {
  private readonly readers = new HistoryReaderScope(
    'Provider request snapshot is closed',
  );
  private closing: Promise<void> | undefined;
  private readonly onAbort = (): void => {
    void this.close().catch(() => undefined);
  };

  private constructor(
    private readonly release: () => void | Promise<void>,
    readonly indexed: IndexedJournalRequestSnapshot,
    private readonly signal?: AbortSignal,
    private readonly ownership?: RowOwnership,
  ) {
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  static async create(
    snapshot: VersionSnapshot,
    tail: readonly IContent[],
    options: ProviderCuratedStreamOptions,
    projection?: JournalRequestProjection,
    release: () => void | Promise<void> = () => snapshot.close(),
  ): Promise<JournalProviderRequestSnapshot> {
    let indexed: IndexedJournalRequestSnapshot | undefined;
    try {
      options.signal?.throwIfAborted();
      indexed = await IndexedJournalRequestSnapshot.create(
        snapshot,
        tail,
        projection,
      );
      options.signal?.throwIfAborted();
      return new JournalProviderRequestSnapshot(
        release,
        indexed,
        options.signal,
        options.ownership,
      );
    } catch (error) {
      const failures: unknown[] = [];
      for (const close of [() => indexed?.close(), release]) {
        try {
          await close();
        } catch (failure) {
          failures.push(failure);
        }
      }
      throw historyMutationFailure(error, failures);
    }
  }

  get count(): number {
    return this.indexed.count;
  }
  get pending(): ProviderRequestSnapshot['pending'] {
    return this.indexed.pending;
  }

  private requireOpen(signal?: AbortSignal): void {
    this.signal?.throwIfAborted();
    signal?.throwIfAborted();
    this.readers.requireOpen();
  }

  isPending(index: number): boolean {
    this.requireOpen();
    return this.indexed.isPending(index);
  }

  readAt(index: number, signal?: AbortSignal): Promise<IContent> {
    this.requireOpen(signal);
    return this.readers.read(async () => {
      const row = await this.indexed.readAt(index, signal ?? this.signal);
      this.requireOpen(signal);
      return row;
    });
  }

  openReader(signal?: AbortSignal): AsyncGenerator<IContent, void, unknown> {
    this.requireOpen(signal);
    const source = this.readers.open(this.rows(signal));
    const reader: AsyncGenerator<IContent, void, unknown> = {
      [Symbol.asyncIterator]: () => reader,
      [Symbol.asyncDispose]: async () => {
        await source.return();
      },
      next: async (value) => {
        try {
          this.requireOpen(signal);
          const result = await source.next(value);
          this.requireOpen(signal);
          return result;
        } catch (error) {
          try {
            await source.return();
          } catch (cleanup) {
            throw historyMutationFailure(error, [cleanup]);
          }
          throw error;
        }
      },
      return: (value) => source.return(value),
      throw: (error) => source.throw(error),
    };
    return reader;
  }

  private async *rows(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of this.indexed.openReader(signal ?? this.signal)) {
      this.requireOpen(signal);
      this.ownership?.retain(row);
      try {
        yield row;
      } finally {
        this.ownership?.release(row);
      }
    }
    this.requireOpen(signal);
  }

  close(): Promise<void> {
    this.signal?.removeEventListener('abort', this.onAbort);
    this.closing ??= this.retire();
    return this.closing;
  }

  private async retire(): Promise<void> {
    const failures: unknown[] = [];
    for (const close of [
      () => this.readers.close(),
      () => this.indexed.close(),
      this.release,
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Provider request snapshot cleanup failed',
      );
  }
}
