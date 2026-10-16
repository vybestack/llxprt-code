/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { CommitAck } from '../../journal/groupWriter.js';
import {
  rowsUnchanged,
  truncationCut,
  type DetachedRows,
} from './detachedRowShapes.js';
import type {
  JournalCompensationMark,
  JournalHistoryStore,
} from './journalHistoryStore.js';

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
    signal?.throwIfAborted();
    if (appendOnly) {
      await this.appendRows(previous, next, signal);
    } else if (!rowsUnchanged(previous, next)) {
      await this.replaceRows(previous, next, signal);
    }
    signal?.throwIfAborted();
  }

  /** Puts the version captured at construction back; nothing is written when no group was acked. */
  async compensate(): Promise<void> {
    await this.store.compensate(this.mark);
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
