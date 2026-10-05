/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryJournalOp } from './historyJournalStore.js';
import type { HistoryReadCursor } from '../../recording/synchronousHistoryCursor.js';
import { validSeq } from '../../recording/resolverProjection.js';
import { withSynchronousHistoryCursor } from '../../recording/synchronousHistoryCursor.js';
import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import { captureHistoryOrdinalDirectory } from '../../recording/synchronousHistoryCursor.js';
import type { MutableRowDirectory } from '../../recording/mutableRowDirectory.js';
import { applyPending } from '../../recording/pendingRowFold.js';

interface PublicationOrdinalLease {
  directory?: MutableRowDirectory;
  sequence: number;
  enabled: boolean;
}

export class HistoryPublicationOrdinals {
  private lease: PublicationOrdinalLease | undefined;

  async run(sequence: number, action: () => Promise<void>): Promise<void> {
    if (this.lease !== undefined)
      throw new Error('Journal publication projection is already active');
    const lease: PublicationOrdinalLease = { sequence, enabled: true };
    this.lease = lease;
    try {
      await action();
    } finally {
      this.lease = undefined;
      lease.directory?.close();
    }
  }

  admitted(sequence: number): void {
    if (this.lease !== undefined) this.lease.sequence = sequence;
  }

  project(
    op: HistoryJournalOp,
    length: number,
    sequence: number,
    capture: () => PendingFoldSnapshot,
    read: <T>(execute: (cursor: HistoryReadCursor) => T) => T,
  ): number {
    const lease = this.lease;
    if (lease !== undefined) {
      if (lease.sequence !== sequence) {
        lease.enabled = false;
        lease.directory?.close();
        lease.directory = undefined;
      }
      if (
        lease.enabled &&
        op.kind === 'density' &&
        op.payload.removedSeqs.length > 0
      )
        lease.directory ??= captureHistoryOrdinalDirectory(capture());
      if (lease.directory !== undefined) {
        applyPending(lease.directory, op, 0);
        return lease.directory.length;
      }
    }
    return nextHistoryLength(op, length, read);
  }
}

interface ScalarLengthBinding {
  rowCount: number | null;
  readonly seeded: boolean;
  readonly durableTail: number;
  readonly lastSeq: number | null;
}

export function readHistoryLength(
  binding: ScalarLengthBinding,
  capture: () => PendingFoldSnapshot,
  counters?: JournalReadCounters,
): { readonly length: number; readonly durableTail: number } {
  if (binding.rowCount !== null)
    return { length: binding.rowCount, durableTail: binding.durableTail };
  const snapshot = capture();
  const length = withSynchronousHistoryCursor(
    snapshot,
    (cursor) => cursor.length,
    counters,
  );
  // An adopted watermark is fixed. An unbound external recorder can still
  // grow: only successful local admission binds its prefix and exact count.
  if (binding.seeded || binding.lastSeq !== null) binding.rowCount = length;
  return { length, durableTail: snapshot.durableTail };
}

function firstChronology(
  cursor: HistoryReadCursor,
  seq: number | undefined,
): number {
  if (seq === undefined) return -1;
  for (let index = 0; index < cursor.length; index++)
    if (cursor.chronologySeqAt(index) === seq) return index;
  return -1;
}

/** Membership-changing operations resolve markers, never content rows. */
export function nextHistoryLength(
  op: HistoryJournalOp,
  length: number,
  read: <T>(execute: (cursor: HistoryReadCursor) => T) => T,
): number {
  switch (op.kind) {
    case 'content':
      return length + 1;
    case 'compressed':
      return 1;
    case 'compressionDetail':
      return length;
    case 'rewind':
      if (op.cutSeq === undefined) return Math.max(0, length - op.itemsRemoved);
      return read((cursor) => {
        const position = firstChronology(cursor, op.cutSeq);
        return position === -1
          ? Math.max(0, cursor.length - op.itemsRemoved)
          : position;
      });
    case 'syntheticInsert':
      if (!validSeq(op.payload.chronologySeq) || !validSeq(op.payload.afterSeq))
        return length;
      return read((cursor) => {
        for (let index = 0; index < cursor.length; index++)
          if (cursor.chronologySeqAt(index) === op.payload.afterSeq)
            return cursor.length + 1;
        return cursor.length;
      });
    case 'density': {
      const { removedSeqs, replacements } = op.payload;
      if (
        !removedSeqs.every(validSeq) ||
        !replacements.every((entry) => validSeq(entry.replacedSeq))
      )
        return length;
      const removed = new Set(removedSeqs);
      for (const entry of replacements) removed.delete(entry.replacedSeq);
      if (removed.size === 0) return length;
      return read((cursor) => {
        let next = cursor.length;
        for (let index = 0; index < cursor.length; index++) {
          const seq = cursor.chronologySeqAt(index);
          if (seq !== undefined && removed.has(seq)) next--;
        }
        return next;
      });
    }
    default: {
      const exhaustive: never = op;
      void exhaustive;
      throw new Error('Unmapped scalar history operation');
    }
  }
}
