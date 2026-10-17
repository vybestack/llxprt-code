/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from '../../journal/aggregate.js';
import { EMPTY_AGGREGATE } from '../../journal/aggregateComposition.js';
import { CHRONOLOGY_SEQ_NONE } from '../../journal/rowRecord.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { ConversationStatistics } from './curationDebugLogger.js';
import type { HistoryRowView } from './historyRowView.js';
import type { IContent } from './IContent.js';
import type { JournalOwners } from './journalOwners.js';
import { decodeStoredRow } from './journalRowCodec.js';

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
): Promise<IContent | undefined> {
  const version = snapshot.version;
  if (version === undefined || version.rows === 0) return undefined;
  if (speaker === undefined) {
    const entry = await snapshot.entryAt(version.rows - 1);
    return decodeStoredRow(await snapshot.readRow(entry));
  }
  const label = LAST_LABEL_OF[speaker](version.aggregate);
  if (label === 0n) return undefined;
  const entry = await snapshot.entryByLabel(label);
  if (entry === undefined) {
    throw new Error(
      `The aggregate names row ${label} as the last ${speaker} row, and no live row has that label`,
    );
  }
  return decodeStoredRow(await snapshot.readRow(entry));
}

/** The facts of the rows of one pinned version; every read goes to the file. */
export class JournalRowView implements HistoryRowView {
  private closed = false;

  constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly owners: JournalOwners,
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

  async *rows(): AsyncGenerator<IContent, void, unknown> {
    this.assertOpen();
    for await (const entry of this.snapshot.entries()) {
      this.assertOpen();
      yield decodeStoredRow(await this.snapshot.readRow(entry));
    }
  }

  /** Later reads fail; the snapshot is the store's to release. */
  close(): void {
    this.closed = true;
  }

  private entryAt(index: number): ReturnType<VersionSnapshot['entryAt']> {
    this.assertOpen();
    return this.snapshot.entryAt(index);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The row view is closed');
  }
}
