/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  pendingAppendedRows,
  pendingIsAppendOnly,
  scanAppendedDurableRows,
} from '../../recording/appendedRows.js';
import { tailDigestSync } from '../../recording/durableFoldCheckpoint.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { NumericRow } from '../../recording/mutableRowDirectory.js';
import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import {
  scanSnapshotRows,
  visitSnapshotRows,
} from '../../recording/synchronousHistoryCursor.js';
import { ContextRangeAccumulator } from './contextRange.js';
import {
  StatisticsAccumulator,
  type ConversationStatistics,
} from './curationDebugLogger.js';
import type { ContextRange, RemovedInteriorSpan } from './historyEventTypes.js';
import type { IContent } from './IContent.js';

/**
 * What the scalar history queries need from the rows, folded as the rows pass:
 * the statistics counters, the context boundary with its compressed spans, and
 * where the newest row of each speaker lives. It holds counters and row
 * addresses only, never a row, so its size does not depend on history length.
 */
class RowSummaryState {
  private statistics = new StatisticsAccumulator();
  private range = new ContextRangeAccumulator();
  private lastAny: NumericRow | undefined;
  private readonly lastBySpeaker = new Map<IContent['speaker'], NumericRow>();

  add(content: IContent, row: NumericRow): void {
    this.statistics.add(content);
    this.range.add(content);
    this.lastAny = row;
    this.lastBySpeaker.set(content.speaker, row);
  }

  clone(): RowSummaryState {
    const copy = new RowSummaryState();
    copy.statistics = this.statistics.clone();
    copy.range = this.range.clone();
    copy.lastAny = this.lastAny;
    for (const [speaker, row] of this.lastBySpeaker)
      copy.lastBySpeaker.set(speaker, row);
    return copy;
  }

  conversationStatistics(): ConversationStatistics {
    return this.statistics.statistics();
  }

  contextRange(accumulated: readonly RemovedInteriorSpan[]): ContextRange {
    return this.range.snapshot(accumulated);
  }

  lastRow(speaker?: IContent['speaker']): NumericRow | undefined {
    return speaker === undefined
      ? this.lastAny
      : this.lastBySpeaker.get(speaker);
  }
}

/**
 * The scalar history queries over one pinned snapshot. It is valid until the
 * snapshot it was built from is released.
 */
export class HistoryRowSummary {
  constructor(
    private readonly state: RowSummaryState,
    private readonly snapshot: PendingFoldSnapshot,
    private readonly counters: JournalReadCounters | undefined,
  ) {}

  statistics(): ConversationStatistics {
    return this.state.conversationStatistics();
  }

  contextRange(accumulated: readonly RemovedInteriorSpan[]): ContextRange {
    return this.state.contextRange(accumulated);
  }

  /** The newest row, or the newest by `speaker`, decoded from its address. */
  lastContent(speaker?: IContent['speaker']): IContent | undefined {
    const row = this.state.lastRow(speaker);
    if (row === undefined) return undefined;
    let found: IContent | undefined;
    visitSnapshotRows(this.snapshot, [row], this.counters, (content) => {
      found = content;
    });
    return found;
  }
}

/** The durable journal prefix a saved state describes. */
interface SavedSummary {
  /** Journal and restored-prefix identity, so a different file never resumes. */
  readonly key: string;
  readonly watermark: number;
  /** Digest of the bytes before the watermark; a rewritten file fails it. */
  readonly tailDigest: string;
  readonly state: RowSummaryState;
}

function summaryKey(snapshot: PendingFoldSnapshot, identity: string): string {
  const projection = snapshot.pinnedProjection?.identity ?? 'none';
  return `${identity}|${projection}|${snapshot.resumeBoundary}`;
}

/**
 * Answers the scalar history queries without rescanning the journal from byte
 * zero. It keeps one saved state for the durable prefix, so a query after
 * `n` appended rows reads only those rows. A journal that grew by anything but
 * whole content rows (rewind, compression, density, replace, purge), or a
 * pending overlay that does, is folded again from the start, which is a cost
 * of the mutation, not of the query. The state is the store's own, discarded
 * with it.
 */
export class HistorySummaryTracker {
  private saved: SavedSummary | null = null;

  summarize(
    snapshot: PendingFoldSnapshot,
    counters: JournalReadCounters | undefined,
  ): HistoryRowSummary {
    if (!pendingIsAppendOnly(snapshot)) {
      const state = new RowSummaryState();
      scanSnapshotRows(snapshot, true, counters, (content, row) =>
        state.add(content, row),
      );
      return new HistoryRowSummary(state, snapshot, counters);
    }
    const durable = this.durableState(snapshot, counters);
    if (snapshot.pendingLength === 0)
      return new HistoryRowSummary(durable, snapshot, counters);
    const state = durable.clone();
    visitSnapshotRows(
      snapshot,
      pendingAppendedRows(snapshot),
      counters,
      (content, row) => state.add(content, row),
    );
    return new HistoryRowSummary(state, snapshot, counters);
  }

  dispose(): void {
    this.saved = null;
  }

  private durableState(
    snapshot: PendingFoldSnapshot,
    counters: JournalReadCounters | undefined,
  ): RowSummaryState {
    const journal = snapshot.pinnedJournal;
    if (journal === null || snapshot.durableTail === 0)
      return this.rebuild(snapshot, counters, null);
    const key = summaryKey(snapshot, journal.identity);
    return (
      this.resume(snapshot, key, counters) ??
      this.rebuild(snapshot, counters, key)
    );
  }

  /** The saved state advanced over the rows appended since, or null when it cannot be. */
  private resume(
    snapshot: PendingFoldSnapshot,
    key: string,
    counters: JournalReadCounters | undefined,
  ): RowSummaryState | null {
    const saved = this.saved;
    const journal = snapshot.pinnedJournal;
    if (
      saved === null ||
      journal === null ||
      saved.key !== key ||
      saved.watermark > snapshot.durableTail
    )
      return null;
    if (tailDigestSync(journal.fd, saved.watermark) !== saved.tailDigest) {
      this.saved = null;
      return null;
    }
    if (saved.watermark === snapshot.durableTail) return saved.state;
    const appended = scanAppendedDurableRows(snapshot, saved.watermark);
    if (appended === null) return null;
    try {
      const state = saved.state.clone();
      visitSnapshotRows(snapshot, appended.rows(), counters, (content, row) =>
        state.add(content, row),
      );
      this.save(snapshot, key, state);
      return state;
    } finally {
      appended.close();
    }
  }

  private rebuild(
    snapshot: PendingFoldSnapshot,
    counters: JournalReadCounters | undefined,
    key: string | null,
  ): RowSummaryState {
    const state = new RowSummaryState();
    const { openTransaction } = scanSnapshotRows(
      snapshot,
      false,
      counters,
      (content, row) => state.add(content, row),
    );
    // A transaction still open at the tail changes meaning when its commit
    // arrives, so a state taken there could not be extended by appends.
    if (key !== null && !openTransaction) this.save(snapshot, key, state);
    return state;
  }

  private save(
    snapshot: PendingFoldSnapshot,
    key: string,
    state: RowSummaryState,
  ): void {
    const journal = snapshot.pinnedJournal;
    if (journal === null) return;
    const tailDigest = tailDigestSync(journal.fd, snapshot.durableTail);
    // A tail that is not on a record boundary cannot be resumed from.
    if (tailDigest === null) return;
    this.saved = {
      key,
      watermark: snapshot.durableTail,
      tailDigest,
      state,
    };
  }
}
