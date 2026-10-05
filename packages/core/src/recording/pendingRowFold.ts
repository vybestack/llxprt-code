/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../services/history/IContent.js';
import type { HistoryJournalOp } from '../services/history/historyJournalStore.js';
import type { PendingFoldSnapshot } from './pendingFoldSnapshot.js';
import {
  foldDurableRows,
  UnsupportedDurableFoldEvent,
  type DurableRowFold,
} from './durableRowFold.js';
import { MutableRowDirectory, type NumericRow } from './mutableRowDirectory.js';
import { validSeq } from './resolverProjection.js';

export function pendingContent(op: HistoryJournalOp, offset: number): IContent {
  switch (op.kind) {
    case 'content':
      return op.content;
    case 'compressed':
      return op.summary;
    case 'syntheticInsert':
      return op.payload.content;
    case 'density': {
      if (offset < 1 || offset > op.payload.replacements.length)
        throw new Error('Missing pending density replacement');
      return op.payload.replacements[offset - 1].replacement;
    }
    default:
      throw new Error('Pending slot does not contain content');
  }
}

function pendingOwnerCount(op: HistoryJournalOp): number {
  switch (op.kind) {
    case 'content':
    case 'compressed':
    case 'syntheticInsert':
      return 1;
    case 'density':
      return op.payload.replacements.length;
    case 'rewind':
    case 'compressionDetail':
      return 0;
    default: {
      const exhaustive: never = op;
      void exhaustive;
      throw new Error('Unmapped pending owner');
    }
  }
}

function pendingRow(content: IContent, slot: number, offset = 0): NumericRow {
  const marker = content.metadata?.chronology?.seq;
  if (marker !== undefined && !validSeq(marker))
    throw new UnsupportedDurableFoldEvent('non_numeric_chronology');
  return {
    source: 'pending',
    offset,
    bytes: 0,
    pendingSlot: slot,
    chronologySeq: marker ?? null,
    invalidateResponses: false,
  };
}

function applyDensity(
  directory: MutableRowDirectory,
  op: Extract<HistoryJournalOp, { kind: 'density' }>,
  slot: number,
): void {
  const { removedSeqs, replacements } = op.payload;
  if (
    !removedSeqs.every(validSeq) ||
    !replacements.every((entry) => validSeq(entry.replacedSeq))
  )
    return;
  directory.transform((row) => {
    const seq = row.chronologySeq;
    if (seq === null) return row;
    for (let index = replacements.length - 1; index >= 0; index--) {
      if (replacements[index].replacedSeq === seq)
        return pendingRow(replacements[index].replacement, slot, index + 1);
    }
    return removedSeqs.includes(seq) ? null : row;
  });
}

export function applyPending(
  directory: MutableRowDirectory,
  op: HistoryJournalOp,
  slot: number,
): void {
  switch (op.kind) {
    case 'content':
      directory.append(pendingRow(op.content, slot));
      return;
    case 'compressed':
      directory.truncate(0);
      directory.append(pendingRow(op.summary, slot));
      return;
    case 'rewind': {
      const cut = op.cutSeq;
      if (cut !== undefined && !validSeq(cut))
        throw new UnsupportedDurableFoldEvent('non_numeric_rewind_cut');
      const position = cut === undefined ? -1 : directory.firstChronology(cut);
      directory.truncate(
        position === -1
          ? Math.max(0, directory.length - op.itemsRemoved)
          : position,
      );
      return;
    }
    case 'syntheticInsert': {
      const { content, chronologySeq, afterSeq } = op.payload;
      if (!validSeq(chronologySeq) || !validSeq(afterSeq)) return;
      const anchor = directory.firstChronology(afterSeq);
      if (anchor !== -1)
        directory.insert(anchor + 1, pendingRow(content, slot));
      return;
    }
    case 'density':
      applyDensity(directory, op, slot);
      return;
    case 'compressionDetail':
      return;
    default: {
      const exhaustive: never = op;
      void exhaustive;
      throw new Error('Unmapped pending operation');
    }
  }
}

/** Private fold; owns durable handles and scratch until close (also on failure). */
export class PendingRowFold {
  private closed = false;
  constructor(
    private snapshot: PendingFoldSnapshot | null,
    private readonly directory: MutableRowDirectory,
    private readonly durable: DurableRowFold | null,
  ) {}

  get length(): number {
    return this.directory.length;
  }
  rowAt(index: number): NumericRow {
    return this.directory.rowAt(index);
  }
  metrics(): ReturnType<MutableRowDirectory['metrics']> {
    return this.directory.metrics();
  }

  async readRow(index: number): Promise<IContent> {
    if (this.closed || this.snapshot === null)
      throw new Error('Pending row fold is closed');
    const row = this.directory.rowAt(index);
    if (row.source === 'pending') return this.readPendingRow(index);
    if (this.durable === null) throw new Error('Missing durable row source');
    return this.durable.readNumericRow(row);
  }

  pendingOwners(): Generator<IContent, void, unknown> {
    if (this.closed || this.snapshot === null)
      throw new Error('Pending row fold is closed');
    let slot = 0;
    let offset = 0;
    let active = true;
    const next = (): IteratorResult<IContent, void> => {
      if (!active) return { done: true, value: undefined };
      if (this.closed || this.snapshot === null)
        throw new Error('Pending row fold is closed');
      while (slot < this.snapshot.pendingLength) {
        const op = this.snapshot.pending.read(slot).op;
        const count = pendingOwnerCount(op);
        if (offset < count)
          return { done: false, value: pendingContent(op, ++offset) };
        slot++;
        offset = 0;
      }
      active = false;
      return { done: true, value: undefined };
    };
    return {
      next,
      return: (): IteratorResult<IContent, void> => {
        active = false;
        return { done: true, value: undefined };
      },
      throw: (error?: unknown): IteratorResult<IContent, void> => {
        active = false;
        throw error;
      },
      [Symbol.iterator](): Generator<IContent, void, unknown> {
        return this;
      },
      [Symbol.dispose](): void {
        active = false;
      },
    };
  }

  readPendingRow(index: number): IContent {
    if (this.closed || this.snapshot === null)
      throw new Error('Pending row fold is closed');
    const row = this.directory.rowAt(index);
    if (row.source !== 'pending')
      throw new Error('Pending row source is not pending');
    if (row.pendingSlot >= this.snapshot.pendingLength)
      throw new Error('Pending snapshot slot changed');
    return pendingContent(
      this.snapshot.pending.read(row.pendingSlot).op,
      row.offset,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const snapshot = this.snapshot;
    this.snapshot = null;
    try {
      await this.durable?.close();
    } finally {
      try {
        snapshot?.release();
      } finally {
        this.directory.close();
      }
    }
  }
}

export async function foldPendingRows(
  snapshot: PendingFoldSnapshot,
  options: { readonly scratchRoot?: string; readonly chunkBytes?: number } = {},
): Promise<PendingRowFold> {
  let durable: DurableRowFold | null = null;
  let directory: MutableRowDirectory | null = null;
  try {
    if (snapshot.durableTail > 0) {
      if (snapshot.pinnedJournal === null)
        throw new Error('Pending fold snapshot has no pinned journal');
      durable = await foldDurableRows({
        filePath: snapshot.filePath ?? undefined,
        maxBytes: snapshot.durableTail,
        resumeBoundary: snapshot.resumeBoundary,
        projectionPath: snapshot.projectionPath,
        pinnedJournal: snapshot.pinnedJournal,
        pinnedProjection: snapshot.pinnedProjection ?? undefined,
        ...options,
      });
    }
    directory = new MutableRowDirectory(options.scratchRoot);
    if (durable !== null)
      for (let index = 0; index < durable.length; index++)
        directory.append(durable.rowAt(index));
    for (let slot = 0; slot < snapshot.pendingLength; slot++) {
      applyPending(directory, snapshot.pending.read(slot).op, slot);
    }
    return new PendingRowFold(snapshot, directory, durable);
  } catch (error) {
    try {
      await durable?.close();
    } catch {
      // Keep the fold failure as the primary error.
    }
    try {
      snapshot.release();
    } catch {
      // A failed release must not skip scratch cleanup or replace the fold error.
    }
    try {
      directory?.close();
    } catch {
      // Scratch cleanup must not replace the fold error.
    }
    throw error;
  }
}
