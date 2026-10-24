/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from '../../journal/aggregate.js';
import { EMPTY_AGGREGATE } from '../../journal/aggregateComposition.js';
import { CHRONOLOGY_SEQ_NONE } from '../../journal/rowRecord.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { releaseRead } from '../../journal/pinLease.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import type { ConversationStatistics } from './curationDebugLogger.js';
import type { ContextRange, RemovedInteriorSpan } from './historyEventTypes.js';
import type { HistoryRowView } from './historyRowView.js';
import type { IContent } from './IContent.js';
import type { JournalOwners } from './journalOwners.js';
import { decodeStoredRow } from './journalRowCodec.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import { countDecodedRow } from './journalRowCounters.js';
import {
  findCurrentTurnMarker,
  type CurrentTurnMarker,
} from './historyChronology.js';
import { suffixStart } from './journalSuffix.js';
import type { HistorySuffixQuery } from './historyJournalRows.js';

export async function* streamSnapshotRows(
  snapshot: VersionSnapshot,
  boundary: bigint | undefined,
  counters: JournalReadCounters | undefined,
  query?: HistorySuffixQuery,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  let failure: { readonly error: unknown } | undefined;
  try {
    signal?.throwIfAborted();
    const start = await suffixStart(
      snapshot,
      query,
      signal,
      boundary,
      counters,
    );
    for await (const entry of snapshot.entries(start)) {
      signal?.throwIfAborted();
      const row = decodeStoredRow(await snapshot.readRow(entry), boundary);
      const release = countDecodedRow(row, counters);
      try {
        yield row;
      } finally {
        release();
      }
    }
    signal?.throwIfAborted();
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await releaseRead(snapshot, failure);
  }
}

/**
 * What `getContextRange()` takes from the stored rows: the chronology
 * boundary and the entry count. The spans removed from the interior belong to
 * the service's span window, not to the rows.
 */
export interface ContextBoundary {
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly totalEntries: number;
  /** A row without a chronology marker makes the boundary approximate. */
  readonly approximate: boolean;
}

/** The statistics the root aggregate of a version holds; no row is read. */
export function statisticsOf(
  aggregate: Aggregate = EMPTY_AGGREGATE,
): ConversationStatistics {
  return {
    totalMessages: aggregate.rows,
    userMessages: aggregate.humanRows,
    aiMessages: aggregate.aiRows,
    toolCalls: aggregate.toolCallBlocks,
    toolResponses: aggregate.responseBlocks,
  };
}

function seqOrZero(seq: bigint): number {
  return seq === CHRONOLOGY_SEQ_NONE ? 0 : Number(seq);
}

/** The boundary the root aggregate of a version holds; no row is read. */
export function contextBoundaryOf(
  aggregate: Aggregate = EMPTY_AGGREGATE,
): ContextBoundary {
  const empty = aggregate.rows === 0;
  return {
    firstSeq: empty ? 0 : seqOrZero(aggregate.firstSeq),
    lastSeq: empty ? 0 : seqOrZero(aggregate.lastSeq),
    totalEntries: aggregate.rows,
    approximate: aggregate.noChronologyRows > 0,
  };
}

/** The boundary of a version joined with the spans accumulated by the service's mutations. */
export function contextRangeOf(
  boundary: ContextBoundary,
  accumulated: readonly RemovedInteriorSpan[],
  summaries: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
  }> = [],
): ContextRange {
  return {
    ...boundary,
    removedInterior: mergeRemovedInteriorSpans([
      ...accumulated,
      ...summaries.map(
        (span): RemovedInteriorSpan => ({ ...span, reason: 'compressed' }),
      ),
    ]),
  };
}

const LAST_LABEL_OF = {
  human: (aggregate) => aggregate.lastHuman,
  ai: (aggregate) => aggregate.lastAi,
  tool: (aggregate) => aggregate.lastTool,
} as const satisfies Record<
  IContent['speaker'],
  (aggregate: Aggregate) => bigint
>;

/**
 * The newest row of the snapshot, or the newest of `speaker`: the row at the
 * end of the tree, or the row the aggregate's per-speaker label names. Either
 * way one descent and one row read, and nothing is kept.
 */
export async function lastContentOf(
  snapshot: VersionSnapshot,
  speaker?: IContent['speaker'],
  resumeBoundary?: bigint,
): Promise<IContent | undefined> {
  const version = snapshot.version;
  if (version === undefined || version.rows === 0) return undefined;
  if (speaker === undefined) {
    const entry = await snapshot.entryAt(version.rows - 1);
    return decodeStoredRow(await snapshot.readRow(entry), resumeBoundary);
  }
  const label = LAST_LABEL_OF[speaker](version.aggregate);
  if (label === 0n) return undefined;
  const entry = await snapshot.entryByLabel(label);
  if (entry === undefined) {
    throw new Error(
      `The aggregate names row ${label} as the last ${speaker} row, and no live row has that label`,
    );
  }
  return decodeStoredRow(await snapshot.readRow(entry), resumeBoundary);
}

export async function lastTurnMarkerOf(
  snapshot: VersionSnapshot,
  resumeBoundary?: bigint,
  counters?: JournalReadCounters,
): Promise<CurrentTurnMarker | null> {
  for (let index = snapshot.rows - 1; index >= 0; index--) {
    const entry = await snapshot.entryAt(index);
    if (entry.chronologySeq === CHRONOLOGY_SEQ_NONE) continue;
    const row = decodeStoredRow(
      await snapshot.readMetadata(entry),
      resumeBoundary,
    );
    const release = countDecodedRow(row, counters);
    try {
      return findCurrentTurnMarker([row]);
    } finally {
      release();
    }
  }
  return null;
}

/** The facts of the rows of one pinned version; every read goes to the file. */
export class JournalRowView implements HistoryRowView {
  private closed = false;
  private readonly readers = new Set<AsyncGenerator<IContent, void, unknown>>();

  constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly owners: JournalOwners,
    private readonly resumeBoundary?: bigint,
    private readonly counters?: JournalReadCounters,
    private readonly signal?: AbortSignal,
  ) {}

  get length(): number {
    return this.snapshot.rows;
  }

  async originAt(index: number): Promise<string | undefined> {
    const entry = await this.entryAt(index);
    return this.owners.originOf(entry.owner);
  }

  async chronologySeqAt(index: number): Promise<number | undefined> {
    const { chronologySeq } = await this.entryAt(index);
    return chronologySeq === CHRONOLOGY_SEQ_NONE
      ? undefined
      : Number(chronologySeq);
  }

  rows(): AsyncGenerator<IContent, void, unknown> {
    this.assertOpen();
    const reader = this.readRows(() => this.readers.delete(reader));
    this.readers.add(reader);
    return reader;
  }

  private async *readRows(
    onClose: () => void,
  ): AsyncGenerator<IContent, void, unknown> {
    try {
      this.assertOpen();
      for await (const entry of this.snapshot.entries()) {
        this.assertOpen();
        const row = decodeStoredRow(
          await this.snapshot.readRow(entry),
          this.resumeBoundary,
        );
        this.assertOpen();
        const release = countDecodedRow(row, this.counters);
        try {
          yield row;
        } finally {
          release();
        }
      }
      this.assertOpen();
    } finally {
      onClose();
    }
  }

  /** Later reads fail; the snapshot is the store's to release. */
  async close(): Promise<void> {
    this.closed = true;
    const failures: unknown[] = [];
    for (const reader of this.readers) {
      try {
        await reader.return();
      } catch (error) {
        failures.push(error);
      }
    }
    this.readers.clear();
    if (failures.length > 0)
      throw new AggregateError(failures, 'Row view cleanup failed');
  }

  private entryAt(index: number): ReturnType<VersionSnapshot['entryAt']> {
    this.assertOpen();
    return this.snapshot.entryAt(index);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The row view is closed');
    this.signal?.throwIfAborted();
  }
}

export async function withVersionSnapshot<T>(
  snapshot: VersionSnapshot,
  read: (snapshot: VersionSnapshot) => Promise<T>,
): Promise<T> {
  let failure: { readonly error: unknown } | undefined;
  try {
    return await read(snapshot);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await releaseRead(snapshot, failure);
  }
}

interface RowViewScope<T> {
  readonly execute: (view: HistoryRowView) => Promise<T>;
  readonly counters?: JournalReadCounters;
  readonly signal?: AbortSignal;
}

/** Hands `execute` the row view of `snapshot`; the view is closed once `execute` has settled. */
export async function withRowView<T>(
  snapshot: VersionSnapshot,
  owners: JournalOwners,
  boundary: bigint | undefined,
  { execute, counters, signal }: RowViewScope<T>,
): Promise<T> {
  const view = new JournalRowView(snapshot, owners, boundary, counters, signal);
  let result: T;
  try {
    result = await execute(view);
  } catch (primary) {
    try {
      await view.close();
    } catch (cleanup) {
      throw new AggregateError(
        [primary, cleanup],
        'Row view callback and cleanup failed',
      );
    }
    throw primary;
  }
  await view.close();
  return result;
}

export async function materializeJournalRows(this: {
  streamRows(): AsyncIterable<IContent>;
}): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of this.streamRows()) rows.push(row);
  return rows;
}
