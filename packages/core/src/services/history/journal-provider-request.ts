/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { DebugLogger } from '../../debug/index.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { JournalRequestProjection } from './journal-request-projection.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import type { LocalMediaStore } from '../../storage/local-media-store.js';
import { PinnedHistoryMediaLease } from '../../storage/history-media-release-gate.js';
import { HistoryReaderScope } from './historyReaderScope.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import type { ProviderRequestSnapshot } from './provider-request-snapshot.js';
import type { ProviderCuratedStreamOptions } from './provider-request-options.js';
import type { RowFormatRegistration } from '../../journal/rowFormat.js';
import {
  hasNativeRequestFormat,
  type NativeProviderFormat,
  type PrepareNativeRequestFormat,
  type PrepareNativeRequestKimi,
} from './native-provider-format.js';

export class JournalProviderRequestSnapshot implements ProviderRequestSnapshot {
  private readonly readers = new HistoryReaderScope(
    'Provider request snapshot is closed',
  );
  private closing: Promise<void> | undefined;
  private formatSnapshot: VersionSnapshot | undefined;
  private formatQueue: Promise<void> = Promise.resolve();
  private readonly onAbort = (): void => {
    void this.close().catch(() => undefined);
  };

  readonly native: NativeProviderFormat;

  private constructor(
    private readonly release: () => void | Promise<void>,
    readonly indexed: IndexedJournalRequestSnapshot,
    private readonly snapshot: VersionSnapshot,
    private readonly prepareFormat: PrepareNativeRequestFormat | undefined,
    private readonly prepareKimi: PrepareNativeRequestKimi | undefined,
    private readonly signal?: AbortSignal,
    private readonly ownership?: RowOwnership,
    mediaStore: LocalMediaStore | undefined = undefined,
    mediaReferences = new WeakSet<MediaReferenceBlock>(),
  ) {
    this.native = {
      ...(mediaStore === undefined
        ? {}
        : {
            mediaLease: new PinnedHistoryMediaLease(
              mediaStore,
              mediaReferences,
              () => this.requireOpen(),
              (consume) => {
                this.requireOpen();
                return this.readers.read(consume);
              },
            ),
          }),
      indexed,
      withFormat: (registration, consume) =>
        this.withFormat(registration, consume),
      withKimi: (consume) => this.withKimi(consume),
    };
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  private async withFormat<T>(
    registration: RowFormatRegistration,
    consume: (snapshot: VersionSnapshot) => T | Promise<T>,
  ): Promise<T> {
    return this.queueFormat(() => this.consumeFormat(registration, consume));
  }

  private async withKimi<T>(
    consume: (snapshot: VersionSnapshot) => T | Promise<T>,
  ): Promise<T> {
    return this.queueFormat(() => this.consumeKimi(consume));
  }

  private queueFormat<T>(run: () => Promise<T>): Promise<T> {
    this.requireOpen();
    return this.readers.read(() => {
      const next = this.formatQueue.then(run);
      this.formatQueue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    });
  }

  private async consumeKimi<T>(
    consume: (snapshot: VersionSnapshot) => T | Promise<T>,
  ): Promise<T> {
    this.requireOpen();
    let snapshot = this.formatSnapshot ?? this.snapshot;
    if (!(await snapshot.hasKimiFacts())) {
      if (this.prepareKimi === undefined)
        throw new Error(
          'Native Kimi facts need a persistent fill before this pin',
        );
      const filled = await this.prepareKimi(snapshot);
      const previous = this.formatSnapshot;
      this.formatSnapshot = filled;
      snapshot = filled;
      await previous?.close();
    }
    this.requireOpen();
    return this.indexed.withHeld(() => consume(snapshot), this.signal);
  }

  private async consumeFormat<T>(
    registration: RowFormatRegistration,
    consume: (snapshot: VersionSnapshot) => T | Promise<T>,
  ): Promise<T> {
    this.requireOpen();
    let snapshot = this.formatSnapshot ?? this.snapshot;
    if (!hasNativeRequestFormat(snapshot, registration)) {
      if (this.prepareFormat === undefined)
        throw new Error(
          'Native request format needs a persistent fill before this pin',
        );
      const measured = await this.prepareFormat(snapshot, registration);
      const previous = this.formatSnapshot;
      this.formatSnapshot = measured;
      snapshot = measured;
      await previous?.close();
    }
    this.requireOpen();
    return this.indexed.withHeld(() => consume(snapshot), this.signal);
  }

  static async create(
    snapshot: VersionSnapshot,
    tail: readonly IContent[],
    options: ProviderCuratedStreamOptions,
    projection?: JournalRequestProjection,
    release: () => void | Promise<void> = () => snapshot.close(),
    prepareFormat?: PrepareNativeRequestFormat,
    mediaStore?: LocalMediaStore,
    prepareKimi?: PrepareNativeRequestKimi,
    diagnostics?: {
      readonly logger: DebugLogger;
      readonly isCompressing: boolean;
    },
  ): Promise<JournalProviderRequestSnapshot> {
    const mediaReferences = new WeakSet<MediaReferenceBlock>();
    let indexed: IndexedJournalRequestSnapshot | undefined;
    try {
      options.signal?.throwIfAborted();
      indexed = await IndexedJournalRequestSnapshot.create(
        snapshot,
        tail,
        projection,
        mediaStore === undefined ? undefined : mediaReferences,
        diagnostics === undefined
          ? undefined
          : { ...diagnostics, signal: options.signal },
      );
      options.signal?.throwIfAborted();
      return new JournalProviderRequestSnapshot(
        release,
        indexed,
        snapshot,
        prepareFormat,
        prepareKimi,
        options.signal,
        options.ownership,
        mediaStore,
        mediaReferences,
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

  get index(): IndexedJournalRequestSnapshot {
    return this.indexed;
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
    const source = this.readers.open(
      this.ownership === undefined
        ? this.indexed.openReader(signal ?? this.signal)
        : this.rows(this.ownership, signal),
    );
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
    ownership: RowOwnership,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for await (const row of this.indexed.openReader(signal ?? this.signal)) {
      this.requireOpen(signal);
      ownership.retain(row);
      try {
        yield row;
      } finally {
        ownership.release(row);
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
      () => this.formatSnapshot?.close(),
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
