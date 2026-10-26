/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { JournalDisplayHandle } from './journal-display-commands.js';
import type { JournalDisplayDescriptor } from '../../journal/display-recording.js';
import type { JournalDisplayCommands } from './journal-display-commands.js';
import type { IContent } from './IContent.js';
import type { JournalMirrors } from './journalMirrors.js';
import type {
  JournalHistoryStoreOptions,
  OpenJournal,
} from './journal-history-store-types.js';
import type { HistoryRowView } from './historyRowView.js';
import type { ConversationStatistics } from './curationDebugLogger.js';
import type { ContextRange, RemovedInteriorSpan } from './historyEventTypes.js';
import type { HistorySuffixQuery } from './historyJournalRows.js';
import type { CurrentTurnMarker } from './historyChronology.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import {
  committedBatchSource,
  type CommittedBatchRowSource,
} from './journalBatchSource.js';
import {
  contextBoundaryOf,
  contextRangeOf,
  withRowView,
  withVersionSnapshot,
  lastContentOf,
  lastTurnMarkerOf,
  streamSnapshotRows,
  statisticsOf,
  materializeJournalRows,
  type ContextBoundary,
} from './journalScalars.js';

export abstract class JournalHistoryStoreReads {
  protected abstract readonly display: JournalDisplayCommands;

  appendDisplay(
    descriptor: JournalDisplayDescriptor,
    source: string | AsyncIterable<string>,
    origin?: string,
  ): Promise<JournalDisplayHandle> {
    this.assertUsable();
    return this.display.append(descriptor, source, origin);
  }

  retractDisplay(row: JournalDisplayHandle): Promise<void> {
    this.assertUsable();
    return this.display.retract(row);
  }

  async hasPromptSubmission(id: string): Promise<boolean> {
    await this.waitForDurable();
    return (
      (await this.requireOpen().session.store.getMeta(`submission:${id}`)) !==
      undefined
    );
  }

  async flushCommitted(): Promise<void> {
    await this.waitForDurable();
    await this.settleFanout();
    await this.requireOpen().session.store.flushCommitted();
    await this.mirrors.flushCommitted();
  }

  protected abstract readonly options: JournalHistoryStoreOptions;
  protected abstract journal: OpenJournal | undefined;
  protected abstract boundary: bigint | undefined;
  protected abstract requireOpen(): OpenJournal;
  protected abstract assertUsable(): void;
  abstract waitForDurable(): Promise<void>;
  abstract settleFanout(): Promise<void>;
  protected readonly openDumps = new Set<JournalDumpSnapshot>();

  /** The per-agent mirror files bound to this history. */
  get mirrors(): JournalMirrors {
    return this.requireOpen().mirrors;
  }

  /** Rows with a label below this were written by an earlier process; every reader applies it (D-S08-3). */
  get resumeBoundary(): bigint | undefined {
    return this.boundary;
  }

  /**
   * The rows of the history once the queue is durable, as of the version
   * published at the first read; later groups do not show in a stream that
   * has started.
   */
  async *streamRows(
    query?: HistorySuffixQuery,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    signal?.throwIfAborted();
    this.assertUsable();
    await this.waitForDurable();
    const snapshot = await this.requireOpen().session.store.snapshot();
    yield* streamSnapshotRows(
      snapshot,
      this.resumeBoundary,
      this.options.counters,
      query,
      signal,
    );
  }

  /**
   * The last `count` rows (all rows when omitted) of the version published
   * now, as the source of a batch event. Call it once the publication it
   * announces is acked. The source holds a pin until its dispatcher retires it.
   */
  async committedBatch(count?: number): Promise<CommittedBatchRowSource> {
    const snapshot = await this.requireOpen().session.store.snapshot();
    try {
      return committedBatchSource(
        snapshot,
        count ?? snapshot.rows,
        this.resumeBoundary,
        this.options.counters,
      );
    } catch (error) {
      await snapshot.close();
      throw error;
    }
  }

  /**
   * The statistics of the last acked version, from its trailer; nothing is
   * read. Rows still queued are not counted (WIRING G2): a caller that needs
   * them waits for the queue first.
   */
  statistics(): ConversationStatistics {
    return statisticsOf(this.journal?.session.store.published?.aggregate);
  }

  /** The chronology boundary of the last acked version, from its trailer; see {@link statistics}. */
  contextBoundary(): ContextBoundary {
    return contextBoundaryOf(this.journal?.session.store.published?.aggregate);
  }

  /** The boundary joined with the interior spans the service accumulated (WIRING G2). */
  contextRange(accumulated: readonly RemovedInteriorSpan[]): ContextRange {
    const summaries = this.journal?.session.store.contextSpans();
    return contextRangeOf(this.contextBoundary(), accumulated, summaries);
  }

  /**
   * The commit boundary (WIRING G11): the queue is acked and every bound
   * recorder file holds the acked groups. A recorder's own `flush()` does not
   * wait for mirror deliveries, so without the settle the rows of the last
   * turn could be missing from the session file when the next request starts.
   */
  async waitForCommit(): Promise<void> {
    await this.waitForDurable();
    await this.settleFanout();
  }

  /** The newest row, or the newest of `speaker`, once the queue is durable; nothing is kept. */
  lastContent(speaker?: IContent['speaker']): Promise<IContent | undefined> {
    return this.withDurableSnapshot((snapshot) =>
      lastContentOf(snapshot, speaker, this.resumeBoundary),
    );
  }

  currentTurnMarker(): Promise<CurrentTurnMarker | null> {
    return this.withDurableSnapshot((snapshot) =>
      lastTurnMarkerOf(snapshot, this.resumeBoundary, this.options.counters),
    );
  }

  /**
   * Row facts for a mutation, over the version durable now. The view reads the
   * file, so it holds no row, and it fails once `execute` has settled.
   */
  readRows<T>(
    execute: (view: HistoryRowView) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    return this.withDurableSnapshot((snapshot) =>
      withRowView(snapshot, this.requireOpen().owners, this.resumeBoundary, {
        execute,
        counters: this.options.counters,
        signal,
      }),
    );
  }

  protected async withDurableSnapshot<T>(
    read: (snapshot: VersionSnapshot) => Promise<T>,
  ): Promise<T> {
    this.assertUsable();
    await this.waitForDurable();
    return withVersionSnapshot(
      await this.requireOpen().session.store.snapshot(),
      read,
    );
  }

  /** Every row; for tests and tools that need the whole history, which a send never does. */
  materialize = materializeJournalRows;

  async openDumpSnapshot(): Promise<JournalDumpSnapshot> {
    this.assertUsable();
    await this.waitForDurable();
    const dump: JournalDumpSnapshot = new JournalDumpSnapshot(
      await this.requireOpen().session.store.snapshot(),
      this.resumeBoundary,
      this.options.counters,
      () => this.openDumps.delete(dump),
      (snapshot, registration) =>
        this.requireOpen().session.store.prepareSnapshotFacts(
          snapshot,
          registration,
        ),
    );
    this.openDumps.add(dump);
    return dump;
  }

  /**
   * The file the history is recorded in: the named file of the store, else the
   * file of the recorder bound first. Null while the journal is not open and
   * for a bare store, which has neither.
   */
  journalPath(): string | null {
    const open = this.journal;
    if (open === undefined) return null;
    return open.session.named
      ? open.session.path
      : open.mirrors.firstRecorderPath();
  }

  primaryOriginId(): string | undefined {
    return this.journal?.mirrors.primaryOriginId();
  }

  adoptedOrigin(origin: string | undefined): void {
    this.mirrors.adoptedOrigin(origin);
  }
}
