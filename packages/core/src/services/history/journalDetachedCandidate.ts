/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ROW_ENTRY_NO_CHRONOLOGY_SEQ } from '../../journal/rowEntry.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { collectMediaReferences } from '../../storage/media-reference-lifecycle.js';
import { ContextRangeAccumulator } from './contextRange.js';
import type { DensitySpanRows } from './densitySpanRows.js';
import type {
  DetachedHistoryHost,
  DetachedHistorySink,
} from './detachedHistoryMutation.js';
import { validateHistoryEntry } from './historyBatchContracts.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import {
  draftEqualsStored,
  draftOfStoredRow,
} from './journalDetachedPrefix.js';
import type { JournalDetachedPublication } from './journalDetachedPublication.js';
import { pullFeed, type PullFeed } from './journalDetachedStream.js';
import { encodeContentRow, UNOWNED_ROW } from './journalRowCodec.js';

/** The chronology number of an entry; a row without a marker counts as 0, as the span rules do. */
export function entrySeq(entry: RowEntry): number {
  return entry.chronologySeq === ROW_ENTRY_NO_CHRONOLOGY_SEQ
    ? 0
    : Number(entry.chronologySeq);
}

export interface CandidateContext {
  readonly snapshot: VersionSnapshot;
  readonly host: DetachedHistoryHost;
  readonly modelName: string | undefined;
  readonly signal: AbortSignal | undefined;
  readonly publication: JournalDetachedPublication;
  readonly densitySpans: DensitySpanRows;
  readonly appendOnly: boolean;
  readonly baseTokens: number;
  readonly media: PullFeed<MediaReferenceBlock, void> | undefined;
}

/**
 * The result of a detached transform, taken in while it streams. Each row is
 * validated, stamped, counted and encoded once. While the rows are the head of
 * the previous version nothing is written; at the first row that differs the
 * `replace` group is opened and the head is copied into it as stored rows. At
 * the end a result that never differed writes nothing (same rows), one rewind
 * (a cut tail or an emptied history), or is already published (append mode
 * writes one group per row).
 */
export class JournalCandidate {
  tokens: number;
  /** Rows pushed by the transform (rows appended, in append mode). */
  count = 0;
  readonly range = new ContextRangeAccumulator();
  private head = 0;
  private lastSeq = 0;
  private seqsMatch = true;
  private feed: PullFeed<RowDraft, void> | undefined;
  private readonly entries: AsyncGenerator<RowEntry, void, unknown>;

  constructor(private readonly ctx: CandidateContext) {
    this.tokens = ctx.baseTokens;
    this.entries = ctx.snapshot.entries();
  }

  /** In append mode the range starts from the first and last row headers of the previous version. */
  async seedRange(): Promise<void> {
    const { snapshot } = this.ctx;
    if (!this.ctx.appendOnly || snapshot.rows === 0) return;
    const first = await snapshot.entryAt(0);
    const last = await snapshot.entryAt(snapshot.rows - 1);
    this.range.seed({
      firstSeq: entrySeq(first),
      lastSeq: entrySeq(last),
      totalEntries: snapshot.rows,
      approximate:
        first.chronologySeq === ROW_ENTRY_NO_CHRONOLOGY_SEQ ||
        last.chronologySeq === ROW_ENTRY_NO_CHRONOLOGY_SEQ,
    });
  }

  sink(assertActive: () => void): DetachedHistorySink {
    const { snapshot, densitySpans } = this.ctx;
    return {
      appendValue: async (row) => {
        assertActive();
        await this.accept(row);
      },
      appendReplacement: async (ordinal, row) => {
        assertActive();
        const entry = await snapshot.entryAt(ordinal);
        const marked = entry.chronologySeq !== ROW_ENTRY_NO_CHRONOLOGY_SEQ;
        if (marked) {
          row = {
            ...row,
            metadata: {
              ...row.metadata,
              chronology: {
                seq: entrySeq(entry),
                userTurn: entry.chronologyUserTurn,
                step: entry.chronologyStep,
                recordedAt: entry.chronologyRecordedAt,
              },
            },
          };
          densitySpans.append(spanOf(entry, 'density-replaced'));
        }
        await this.accept(row);
      },
      removeValue: async (ordinal) => {
        assertActive();
        const entry = await snapshot.entryAt(ordinal);
        if (entry.chronologySeq !== ROW_ENTRY_NO_CHRONOLOGY_SEQ)
          densitySpans.append(spanOf(entry, 'density-removed'));
      },
    };
  }

  /** Called once the transform has returned: closes the group, or writes the rewind a prefix needs. */
  async finish(): Promise<void> {
    if (this.ctx.appendOnly) return;
    if (this.feed !== undefined) {
      await this.feed.close();
      return;
    }
    const { rows } = this.ctx.snapshot;
    if (this.count < rows)
      await this.ctx.publication.rewindTail(rows - this.count);
  }

  /** The transform failed: the group, if one was opened, stops before its trailer. */
  async abort(error: unknown): Promise<void> {
    await this.feed?.abort(error);
    await this.entries.return();
  }

  /** The span a result that is a shorter prefix of the previous rows leaves behind. */
  async rewoundSpan(): Promise<RemovedInteriorSpan | undefined> {
    const { snapshot } = this.ctx;
    if (this.ctx.appendOnly || this.count >= snapshot.rows || !this.seqsMatch)
      return undefined;
    const newLastSeq = this.count > 0 ? this.lastSeq : 0;
    const previousLastSeq = entrySeq(await snapshot.entryAt(snapshot.rows - 1));
    if (previousLastSeq <= newLastSeq) return undefined;
    return { start: newLastSeq + 1, end: previousLastSeq, reason: 'rewound' };
  }

  private async accept(row: IContent): Promise<void> {
    const { host, modelName, signal, appendOnly } = this.ctx;
    validateHistoryEntry(row, this.count);
    host.chronology.stamp(row);
    this.tokens += await host.estimate([row], modelName, signal);
    this.range.add(row);
    this.lastSeq = row.metadata?.chronology?.seq ?? 0;
    if (appendOnly) await this.ctx.publication.appendOne(row);
    else await this.place(encodeContentRow(row, { owner: UNOWNED_ROW }));
    for (const reference of collectMediaReferences([row]))
      await this.ctx.media?.put(reference);
    this.count++;
  }

  private async place(draft: RowDraft): Promise<void> {
    const entry = await this.nextEntry();
    if (this.feed === undefined) {
      if (entry !== undefined) {
        const stored = await this.ctx.snapshot.readRow(entry);
        if (draftEqualsStored(draft, stored)) {
          this.head++;
          return;
        }
      }
      await this.openGroup();
    }
    await this.feed?.put(draft);
  }

  private async nextEntry(): Promise<RowEntry | undefined> {
    if (!this.seqsMatch) return undefined;
    const next = await this.entries.next();
    const entry = next.done === true ? undefined : next.value;
    this.seqsMatch = entry !== undefined && entrySeq(entry) === this.lastSeq;
    return entry;
  }

  /** Opens the replace group and carries the head into it as stored rows (no decode, none retained). */
  private async openGroup(): Promise<void> {
    const { snapshot, publication, signal } = this.ctx;
    const feed = pullFeed<RowDraft, void>((rows) =>
      publication.publishDrafts(rows, signal),
    );
    this.feed = feed;
    let copied = 0;
    for await (const entry of snapshot.entries()) {
      if (copied++ === this.head) break;
      await feed.put(draftOfStoredRow(await snapshot.readRow(entry)));
    }
  }
}

function spanOf(
  entry: RowEntry,
  reason: RemovedInteriorSpan['reason'],
): RemovedInteriorSpan {
  const seq = entrySeq(entry);
  return { start: seq, end: seq, reason };
}
