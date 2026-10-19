/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from '../../journal/groupEdits.js';
import { JournalInputError } from '../../journal/errors.js';

import type { CommitAck } from '../../journal/groupWriter.js';
import { pulledRows } from './journalDetachedStream.js';
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

  constructor(private readonly store: JournalHistoryStore) {
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
      this.lastAck = await this.store.replaceDrafts(
        inputDrafts(rows),
        signal,
        ownerEdits,
      );
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
    try {
      const draft = encodeAppended(this.store.writes, content, origin);
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
      await this.writePendingAppends();
    } catch (error) {
      this.failure = error;
      throw error;
    }
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
