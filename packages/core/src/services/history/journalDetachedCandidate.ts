/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ROW_ENTRY_NO_CHRONOLOGY_SEQ } from '../../journal/rowEntry.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { collectMediaReferences } from '../../storage/media-reference-lifecycle.js';
import { ContextRangeAccumulator } from './contextRange.js';

import type {
  DetachedHistoryHost,
  DetachedHistorySink,
} from './detachedHistoryMutation.js';
import { validateHistoryEntry } from './historyBatchContracts.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import { trackMutationOwners } from './historyMutationOwnership.js';
import {
  draftEqualsStored,
  draftOfStoredRow,
} from './journalDetachedPrefix.js';
import type { JournalDetachedPublication } from './journalDetachedPublication.js';
import { pullFeed, type PullFeed } from './journalDetachedStream.js';
import type { ResolvedOwner } from './journalOwners.js';
import { encodeContentRow } from './journalRowCodec.js';
import { previewOfContent } from '../../recording/sessionMetaKeys.js';

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
  readonly densitySpans: {
    append(span: RemovedInteriorSpan): void | Promise<void>;
  };
  readonly appendOnly: boolean;
  readonly baseTokens: number;
  readonly media: PullFeed<MediaReferenceBlock, void> | undefined;
  /** Owner of the rows the transform builds (replace mode): the operation's origin, or unowned. */
  readonly owner: ResolvedOwner;
  /** The operation's origin; append mode writes its rows under it. */
  readonly origin: string | undefined;
}

/**
 * The result of a detached transform, taken in while it streams. Each row is
 * validated, stamped, counted and encoded once. While the rows are the head of
 * the previous version nothing is written; at the first row that differs the
 * `replace` group is opened and the head is copied into it as stored rows. At
 * the end a result that never differed writes nothing (same rows), one rewind
 * (a cut tail or an emptied history), or is appended (append mode writes the
 * rows as groups bounded in bytes, the last one at the end).
 */
export class JournalCandidate {
  tokens: number;
  readonly previews = new Map<number, string>();
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
        await this.accept(row, this.ctx.owner.id);
      },
      appendDerived: async (ordinal, row) => {
        assertActive();
        // A row carried over from the source keeps the owner of the entry it comes from (design 5.1).
        const owner = (await snapshot.entryAt(ordinal)).owner;
        await this.accept(row, owner, this.ctx.appendOnly ? owner : undefined);
      },
      appendReplacement: async (ordinal, row) => {
        assertActive();
        const entry = await snapshot.entryAt(ordinal);
        const marked = entry.chronologySeq !== ROW_ENTRY_NO_CHRONOLOGY_SEQ;
        // A replacement is the row it replaces: it keeps that row's owner (design 4.6).
        const owner = entry.owner;
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
          await densitySpans.append(spanOf(entry, 'density-replaced'));
        }
        await this.accept(row, owner);
      },
      removeValue: async (ordinal) => {
        assertActive();
        const entry = await snapshot.entryAt(ordinal);
        if (entry.chronologySeq !== ROW_ENTRY_NO_CHRONOLOGY_SEQ)
          await densitySpans.append(spanOf(entry, 'density-removed'));
      },
    };
  }

  /** Called once the transform has returned: closes the group, or writes the rewind a prefix needs. */
  async finish(): Promise<void> {
    if (this.ctx.appendOnly) {
      await this.ctx.publication.flushAppends();
      return;
    }
    if (this.feed !== undefined) {
      await this.feed.close();
      return;
    }
    this.discardUnrecordedOwner();
    const { rows } = this.ctx.snapshot;
    if (this.count < rows)
      await this.ctx.publication.rewindTail(rows - this.count);
  }

  /** The transform failed: the group, if one was opened, stops before its trailer. */
  async abort(error: unknown): Promise<void> {
    if (this.feed === undefined) this.discardUnrecordedOwner();
    await this.feed?.abort(error);
    await this.ctx.publication.abortAppends(error);
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

  private async accept(
    source: IContent,
    owner: number,
    inheritedOwner?: number,
  ): Promise<void> {
    const marker = source.metadata?.chronology;
    const release = trackMutationOwners(
      marker === undefined ? [source] : [source, marker],
      this.ctx.host.ownership,
    );
    try {
      await this.acceptOwned(source, owner, inheritedOwner);
    } finally {
      release();
    }
  }

  private async acceptOwned(
    source: IContent,
    owner: number,
    inheritedOwner?: number,
  ): Promise<void> {
    const { host, modelName, signal, appendOnly } = this.ctx;
    validateHistoryEntry(source, this.count);
    // The stamper writes the marker in place; the caller's row stays as it was handed in.
    const row =
      source.metadata?.chronology === undefined
        ? { ...source, metadata: { ...source.metadata } }
        : source;
    host.chronology.stamp(row);
    this.tokens += await host.estimate([row], modelName, signal);
    this.range.add(row, false);
    this.lastSeq = row.metadata?.chronology?.seq ?? 0;
    if (appendOnly)
      await this.ctx.publication.appendOne(
        row,
        this.ctx.origin,
        inheritedOwner,
      );
    else {
      const publishedOwner = await this.place(encodeContentRow(row, { owner }));
      if (!this.previews.has(publishedOwner)) {
        const preview = previewOfContent(row);
        if (preview !== undefined) this.previews.set(publishedOwner, preview);
      }
    }
    for (const reference of collectMediaReferences([row]))
      await this.ctx.media?.put(reference);
    this.count++;
  }

  /** No group was written, so the group that was to record a new owner id never existed. */
  private discardUnrecordedOwner(): void {
    if (this.ctx.owner.edits.length > 0)
      this.ctx.publication.discardOwnerRegistration();
  }

  private async place(draft: RowDraft): Promise<number> {
    const entry = await this.nextEntry();
    if (this.feed === undefined) {
      if (entry !== undefined) {
        const stored = await this.ctx.snapshot.readRow(entry);
        if (draftEqualsStored({ ...draft, owner: entry.owner }, stored)) {
          this.head++;
          return entry.owner;
        }
      }
      await this.openGroup();
    }
    await this.feed?.put(draft);
    return draft.owner;
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
      publication.publishDrafts(rows, signal, this.ctx.owner.edits),
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
