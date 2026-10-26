/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  PreparedGroup,
  GroupPreparation,
} from '../../journal/preparedGroup.js';
import type { VersionEdit } from '../../journal/groupEdits.js';
import { JournalInputError } from '../../journal/errors.js';

import type { CommitAck } from '../../journal/groupWriter.js';
import {
  pulledRows,
  pullFeed,
  type PullFeed,
} from './journalDetachedStream.js';
import { JournalDensitySpans } from './journalDensitySpans.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import { SPAN_WINDOW_CAPACITY } from './historySpanWindow.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { IContent } from './IContent.js';
import {
  rowsUnchanged,
  truncationCut,
  type DetachedRows,
} from './detachedRowShapes.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import { applyAppendDrafts, encodeAppended } from './journalOps.js';
import type { JournalCompensationMark } from './journalPublication.js';

async function* inputDrafts(
  rows: AsyncIterable<RowDraft>,
): AsyncGenerator<RowDraft, void, unknown> {
  try {
    yield* rows;
  } catch (error) {
    throw new JournalInputError(error);
  }
}
/** Encoded bytes after which an append group is written, so a long append holds a bounded part in memory. */
const APPEND_GROUP_BYTES = 4 * 1024 * 1024;

type AnnotatedAppend =
  | { readonly draft: RowDraft }
  | { readonly span: RemovedInteriorSpan };

type AppendProjection = (
  spans: JournalDensitySpans,
) => Promise<RemovedInteriorSpan[]>;

function encodedBytes(draft: RowDraft): number {
  return draft.blocks.reduce(
    (sum, block) => sum + block.bytes.length,
    draft.meta.length,
  );
}

/**
 * Publishes a detached candidate on the journal store. A general replacement
 * is one `replace` group (design 4.5); a cut tail is one rewind; rows past the
 * previous length are appended. The replacement counts as durable when the
 * ack of its trailer has arrived, and a failure after that, or during it, is
 * undone with `restore(version)` of the version captured before anything was
 * admitted. The previous rows are never copied.
 */
export class JournalDetachedPublication {
  /** Groups this publication has asked the store to write. */
  admittedCount = 0;
  /** The ack of the last group of this publication; undefined until a trailer is acked. */
  lastAck: CommitAck | undefined;
  private readonly mark: JournalCompensationMark;
  private released = false;
  private pendingAppends: RowDraft[] = [];
  private pendingAppendOwners: Array<number | undefined> = [];
  private pendingAppendBytes = 0;
  private appendOrigin: string | undefined;
  /** The failure this publication's own groups reported; compensation resolves exactly that one. */
  private failure: unknown;
  private prepared: PreparedGroup | undefined;
  private annotated:
    | PullFeed<AnnotatedAppend, RemovedInteriorSpan[]>
    | undefined;
  private annotatedOwner = 0;
  private appendProjection: AppendProjection | undefined;

  async appendSpan(span: RemovedInteriorSpan, origin?: string): Promise<void> {
    if (this.annotated === undefined) {
      await this.flushAppends();
      const owner = await this.store.resolveOwner(origin);
      this.annotatedOwner = owner.id;
      this.annotated = pullFeed(async (events) => {
        let projected: RemovedInteriorSpan[] = [];
        await this.prepare(async (group) => {
          const spans = new JournalDensitySpans(group);
          const drafts = this.annotatedDrafts(events, spans);
          let first = await drafts.next();
          if (first.done !== true) {
            await group.append(
              (async function* (): AsyncGenerator<RowDraft> {
                yield first.value;
                first = { done: true, value: undefined };
                yield* drafts;
              })(),
              owner.edits,
            );
          } else this.store.discardOwnerRegistration();
          if (this.appendProjection === undefined)
            throw new Error('Annotated append projection is not ready');
          projected = await this.appendProjection(spans);
        }, owner.edits);
        return projected;
      });
    }
    await this.annotated.put({ span });
  }

  private async *annotatedDrafts(
    events: AsyncGenerator<AnnotatedAppend, void, unknown>,
    spans: JournalDensitySpans,
  ): AsyncGenerator<RowDraft> {
    for (;;) {
      let next: IteratorResult<AnnotatedAppend, void>;
      try {
        next = await events.next();
      } catch (error) {
        throw new JournalInputError(error);
      }
      if (next.done === true) return;
      if ('span' in next.value) await spans.append(next.value.span);
      else yield next.value.draft;
    }
  }

  async projectAppends(
    accumulated: readonly RemovedInteriorSpan[],
    project: (spans: readonly RemovedInteriorSpan[]) => RemovedInteriorSpan[],
    retain: boolean,
  ): Promise<RemovedInteriorSpan[]> {
    if (this.annotated === undefined)
      return project(
        mergeRemovedInteriorSpans(accumulated).slice(-SPAN_WINDOW_CAPACITY),
      );
    this.appendProjection = async (spans) => {
      const standing = await spans.project(accumulated, []);
      if (retain) await spans.retain(standing);
      return project(standing);
    };
    return this.annotated.close();
  }

  async abortAppends(error: unknown): Promise<void> {
    await this.submissionFeed?.abort(error);
    await this.annotated?.abort(error);
  }

  async prepare(
    prepare: GroupPreparation,
    ownerEdits: readonly VersionEdit[],
  ): Promise<void> {
    try {
      this.admittedCount++;
      this.lastAck = await this.store.prepareDetached(async (group) => {
        this.prepared = group;
        try {
          await prepare(group);
        } finally {
          this.prepared = undefined;
        }
      }, ownerEdits);
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  private submissionFeed: PullFeed<RowDraft, void> | undefined;

  constructor(
    private readonly store: JournalHistoryStore,
    private readonly submissionId?: string,
  ) {
    this.mark = store.captureCompensation();
  }

  /** True once the trailer of the last group this publication wrote has been acked. */
  get durable(): boolean {
    return this.lastAck !== undefined;
  }

  async publish(
    previous: DetachedRows,
    next: DetachedRows,
    signal?: AbortSignal,
    appendOnly = false,
  ): Promise<void> {
    try {
      signal?.throwIfAborted();
      if (appendOnly) {
        await this.appendRows(previous, next, signal);
      } else if (!rowsUnchanged(previous, next)) {
        await this.replaceRows(previous, next, signal);
      }
      signal?.throwIfAborted();
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  /**
   * Publishes the rows `produce` pushes as one `replace` group. The producer
   * is run by the writer's pulls, one row ahead at most, and a failure of the
   * producer aborts the group before its trailer.
   */
  async publishStreamed(
    produce: (put: (row: IContent) => Promise<void>) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      signal?.throwIfAborted();
      this.admittedCount++;
      this.lastAck = await this.store.replaceStreamed(
        pulledRows(produce),
        signal,
      );
      signal?.throwIfAborted();
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  /** Publishes the encoded rows the writer pulls from `rows` as one `replace` group. */
  async publishDrafts(
    rows: AsyncIterable<RowDraft>,
    signal?: AbortSignal,
    ownerEdits: readonly VersionEdit[] = [],
  ): Promise<void> {
    try {
      signal?.throwIfAborted();
      this.admittedCount++;
      if (this.prepared === undefined)
        throw new Error('Detached group is not prepared');
      await this.prepared.build([
        ...ownerEdits,
        { kind: 'replace', rows: inputDrafts(rows) },
      ]);
      signal?.throwIfAborted();
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  /** Removes the last `itemsRemoved` rows (a cut tail, or all of them for an emptied history) as one rewind. */
  async rewindTail(itemsRemoved: number): Promise<void> {
    try {
      await this.rewind(itemsRemoved);
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  /**
   * Takes one row to append under `origin`. Rows are encoded as they come and
   * written together as one group, one durable commit, when the encoded bytes
   * held reach {@link APPEND_GROUP_BYTES} or {@link flushAppends} is called, so
   * no more than that much of a long append is held at once.
   */
  async appendOne(
    content: IContent,
    origin?: string,
    inheritedOwner?: number,
  ): Promise<void> {
    if (this.submissionId !== undefined) {
      await this.appendSubmission(content, origin);
      return;
    }
    try {
      const draft = encodeAppended(this.store.writes, content, origin);
      if (this.annotated !== undefined) {
        await this.annotated.put({
          draft: { ...draft, owner: inheritedOwner ?? this.annotatedOwner },
        });
        return;
      }
      this.pendingAppends.push(draft);
      this.pendingAppendOwners.push(inheritedOwner);
      this.pendingAppendBytes += encodedBytes(draft);
      this.appendOrigin = origin;
      if (this.pendingAppendBytes >= APPEND_GROUP_BYTES)
        await this.writePendingAppends();
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  /** Writes the rows {@link appendOne} still holds; call it once the transform has returned. */
  async flushAppends(): Promise<void> {
    try {
      if (this.submissionId !== undefined) {
        await (await this.submissionFeedFor()).close();
        return;
      }
      await this.writePendingAppends();
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  private async submissionFeedFor(
    origin?: string,
  ): Promise<PullFeed<RowDraft, void>> {
    const id = this.submissionId;
    if (id === undefined) throw new Error('Missing submission identity');
    if (this.submissionFeed !== undefined) return this.submissionFeed;
    const owner = await this.store.resolveOwner(origin);
    this.submissionFeed = pullFeed(async (drafts) => {
      await this.prepare(async (group) => {
        await group.append(inputDrafts(drafts), owner.edits);
        await group.retainMetadata(`submission:${id}`, new Uint8Array([1]));
      }, owner.edits);
    });
    return this.submissionFeed;
  }

  private async appendSubmission(
    content: IContent,
    origin?: string,
  ): Promise<void> {
    const feed = await this.submissionFeedFor(origin);
    const owner = await this.store.resolveOwner(origin);
    await feed.put({
      ...encodeAppended(this.store.writes, content, origin),
      owner: owner.id,
    });
  }

  private async writePendingAppends(): Promise<void> {
    if (this.pendingAppends.length === 0) return;
    const drafts = this.pendingAppends;
    const owners = this.pendingAppendOwners;
    this.pendingAppends = [];
    this.pendingAppendOwners = [];
    this.pendingAppendBytes = 0;
    this.admittedCount++;
    applyAppendDrafts(this.store.writes, drafts, this.appendOrigin, owners);
    await this.store.waitForDurable();
    this.lastAck = this.store.lastAck;
  }

  /** Drops the owner id taken for rows no group was written for. */
  discardOwnerRegistration(): void {
    this.store.discardOwnerRegistration();
  }

  /** Lets go of the version captured at construction; call it once the publication is over, compensated or not. */
  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await this.store.releaseCompensation(this.mark);
  }

  /** Puts the version captured at construction back; nothing is written when no group was acked. */
  async compensate(): Promise<void> {
    await this.store.compensate(this.mark, this.failure);
    this.failure = undefined;
    this.lastAck = undefined;
  }

  private async replaceRows(
    previous: DetachedRows,
    next: DetachedRows,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (next.length === 0 && previous.length > 0) {
      await this.rewind(previous.length);
      return;
    }
    const cut = truncationCut(previous, next);
    if (cut !== undefined) {
      await this.rewind(cut.itemsRemoved);
      return;
    }
    this.admittedCount++;
    this.lastAck = await this.store.replaceFrom(next, next.length, signal);
  }

  private async rewind(itemsRemoved: number): Promise<void> {
    this.admittedCount++;
    if (this.prepared !== undefined) {
      const saved = await this.mark.saved;
      const entry = await saved.entryAt(saved.rows - itemsRemoved);
      await this.prepared.build([
        { kind: 'pop', cutLabel: entry.label, expectedRemoved: itemsRemoved },
      ]);
      return;
    }
    this.store.apply({ kind: 'rewind', itemsRemoved });
    await this.store.waitForDurable();
    this.lastAck = this.store.lastAck;
  }

  /** One group per row, each acked before the next row is read, so the store queues no more than one. */
  private async appendRows(
    previous: DetachedRows,
    next: DetachedRows,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    let ordinal = 0;
    for (const content of next) {
      if (ordinal++ < previous.length) continue;
      signal?.throwIfAborted();
      this.admittedCount++;
      this.store.apply({ kind: 'content', content });
      await this.store.waitForDurable();
      this.lastAck = this.store.lastAck;
    }
  }
}
