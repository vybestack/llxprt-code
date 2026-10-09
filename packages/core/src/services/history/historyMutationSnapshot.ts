/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent, ChronologyMarker } from './IContent.js';
import { setImmediate } from 'node:timers/promises';
import { isSpeakerContent } from './historyJournalGuards.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import {
  foldPendingRows,
  type PendingRowFold,
} from '../../recording/pendingRowFold.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';

export interface HistoryIndexedRows extends Iterable<IContent> {
  readonly length: number;
  readRow(index: number): IContent;
  writeRow?(index: number, row: IContent): void;
}

export type HistoryRowSource = readonly IContent[] | HistoryIndexedRows;

export function historyRowAt(rows: HistoryRowSource, index: number): IContent {
  return 'readRow' in rows ? rows.readRow(index) : rows[index];
}

class HistoryMutationReader implements Generator<IContent, void, unknown> {
  private row: IContent | undefined;

  constructor(
    private readNext: (() => IContent | undefined) | undefined,
    private onClose: (() => void) | undefined,
    private readonly ownership?: RowOwnership,
    private readonly transactionOwnership?: RowOwnership,
  ) {}

  [Symbol.iterator](): Generator<IContent, void, unknown> {
    return this;
  }

  next(): IteratorResult<IContent, void> {
    try {
      return this.readRows();
    } catch (error) {
      this.return();
      throw error;
    }
  }

  private readRows(advance = true): IteratorResult<IContent, void> {
    this.releaseRow();
    if (!advance) return { done: true, value: undefined };
    const row = this.readNext?.();
    if (row === undefined) return this.return();
    this.ownership?.retain(row);
    try {
      this.transactionOwnership?.retain(row);
    } catch (error) {
      this.ownership?.release(row);
      throw error;
    }
    this.row = row;
    return { done: false, value: row };
  }

  private releaseRow(): void {
    const row = this.row;
    this.row = undefined;
    if (row === undefined) return;
    try {
      this.transactionOwnership?.release(row);
    } finally {
      this.ownership?.release(row);
    }
  }

  return(): IteratorResult<IContent, void> {
    const onClose = this.onClose;
    this.readNext = undefined;
    this.onClose = undefined;
    try {
      this.readRows(false);
    } finally {
      onClose?.();
    }
    return { done: true, value: undefined };
  }

  throw(error?: unknown): IteratorResult<IContent, void> {
    this.return();
    throw error;
  }

  [Symbol.dispose](): void {
    this.return();
  }
}

export class HistoryMutationSnapshot implements Iterable<IContent> {
  private readonly root: string;
  private readonly rows: number;
  private readonly index: number;
  private count = 0;
  private offset = 0;
  private pendingCount = 0;
  private readonly pendingMarkers = new Map<
    number,
    {
      readonly hadMetadata: boolean;
      readonly chronology: ChronologyMarker | undefined;
    }
  >();
  private closed = false;
  private readonly iterators = new Map<
    object,
    Generator<IContent, void, unknown>
  >();

  constructor(
    private source: PendingRowFold | undefined,
    private readonly ownership: RowOwnership | undefined,
    private releasePinned: (() => void) | undefined,
    readonly durableTail: number,
    private readonly transactionOwnership?: RowOwnership,
  ) {
    this.root = mkdtempSync(join(tmpdir(), 'history-mutation-'));
    let rows: number | undefined;
    try {
      rows = openSync(join(this.root, 'rows'), 'w+');
      this.index = openSync(join(this.root, 'index'), 'w+');
      this.rows = rows;
    } catch (error) {
      try {
        if (rows !== undefined) closeSync(rows);
      } finally {
        rmSync(this.root, { recursive: true, force: true });
      }
      throw error;
    }
  }

  get length(): number {
    return this.count;
  }

  get hasPendingRows(): boolean {
    return this.pendingCount > 0;
  }

  private activeSource(): PendingRowFold {
    if (this.closed || this.source === undefined)
      throw new Error('History mutation snapshot is closed');
    return this.source;
  }

  append(content: IContent): void {
    const pending = this.activeSource().rowAt(this.count).source === 'pending';
    if (pending)
      this.pendingMarkers.set(this.count, {
        hadMetadata: content.metadata !== undefined,
        chronology: content.metadata?.chronology,
      });
    const bytes = pending
      ? Buffer.alloc(0)
      : Buffer.from(JSON.stringify(content));
    const position = Buffer.alloc(24);
    position.writeDoubleLE(this.offset, 0);
    position.writeDoubleLE(bytes.length, 8);
    position.writeDoubleLE(pending ? this.count : -1, 16);
    this.write(this.rows, bytes, this.offset);
    this.write(this.index, position, this.count * 24);
    this.offset += bytes.length;
    this.count++;
    if (pending) this.pendingCount++;
  }

  private write(fd: number, bytes: Buffer, offset: number): void {
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(
        fd,
        bytes,
        written,
        bytes.length - written,
        offset + written,
      );
      if (count === 0)
        throw new Error('Mutation snapshot write made no progress');
      written += count;
    }
  }

  private read(fd: number, bytes: Buffer, offset: number): void {
    let consumed = 0;
    while (consumed < bytes.length) {
      const count = readSync(
        fd,
        bytes,
        consumed,
        bytes.length - consumed,
        offset + consumed,
      );
      if (count === 0)
        throw new Error('Mutation snapshot ended before its row boundary');
      consumed += count;
    }
  }

  isPendingRow(index: number): boolean {
    this.activeSource();
    const position = Buffer.alloc(24);
    this.read(this.index, position, index * 24);
    return position.readDoubleLE(16) >= 0;
  }

  readRow(index: number): IContent {
    const source = this.activeSource();
    const position = Buffer.alloc(24);
    this.read(this.index, position, index * 24);
    const pendingIndex = position.readDoubleLE(16);
    if (pendingIndex >= 0) return source.readPendingRow(pendingIndex);
    const bytes = Buffer.alloc(position.readDoubleLE(8));
    this.read(this.rows, bytes, position.readDoubleLE(0));
    const content: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isSpeakerContent(content))
      throw new Error('Invalid mutation snapshot row');
    return content;
  }

  [Symbol.iterator](): Generator<IContent, void, unknown> {
    this.activeSource();
    let index = 0;
    const key = {};
    const iterator = new HistoryMutationReader(
      () => (index < this.count ? this.readRow(index++) : undefined),
      () => this.iterators.delete(key),
      this.ownership,
      this.transactionOwnership,
    );
    this.iterators.set(key, iterator);
    return iterator;
  }

  restorePendingChronology(): void {
    const source = this.activeSource();
    for (const [index, original] of this.pendingMarkers) {
      const row = source.readPendingRow(index);
      if (!original.hadMetadata) delete row.metadata;
      else if (original.chronology === undefined) {
        if (row.metadata !== undefined) delete row.metadata.chronology;
      } else if (row.metadata?.chronology !== original.chronology) {
        row.metadata ??= {};
        row.metadata.chronology = original.chronology;
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const source = this.source;
    const releasePinned = this.releasePinned;
    this.source = undefined;
    this.releasePinned = undefined;
    try {
      for (const iterator of this.iterators.values()) iterator.return();
    } finally {
      this.iterators.clear();
      try {
        this.pendingMarkers.clear();
        releasePinned?.();
        await source?.close();
      } finally {
        this.closeStorage();
      }
    }
  }

  private closeStorage(): void {
    try {
      closeSync(this.index);
    } finally {
      try {
        closeSync(this.rows);
      } finally {
        rmSync(this.root, { recursive: true, force: true });
      }
    }
  }
}

async function captureMutationRow(
  source: PendingRowFold,
  index: number,
  snapshot: HistoryMutationSnapshot,
  counters?: JournalReadCounters,
): Promise<void> {
  const row = await source.readRow(index);
  counters?.rowDecoded();
  try {
    counters?.ownership?.retain(row);
    try {
      snapshot.append(row);
    } finally {
      counters?.ownership?.release(row);
    }
  } finally {
    counters?.rowReleased();
  }
}

function createMutationSnapshot(
  source: PendingRowFold,
  durableTail: number,
  counters?: JournalReadCounters,
  transactionOwnership?: RowOwnership,
): HistoryMutationSnapshot {
  return new HistoryMutationSnapshot(
    source,
    counters?.ownership,
    undefined,
    durableTail,
    transactionOwnership,
  );
}

export async function captureHistoryMutationSnapshot(
  captured: PendingFoldSnapshot,
  counters?: JournalReadCounters,
  transactionOwnership?: RowOwnership,
  signal?: AbortSignal,
): Promise<HistoryMutationSnapshot> {
  const source = await foldPendingRows(captured);
  let snapshot: HistoryMutationSnapshot;
  try {
    snapshot = createMutationSnapshot(
      source,
      captured.durableTail,
      counters,
      transactionOwnership,
    );
  } catch (error) {
    await source.close();
    throw error;
  }
  try {
    for (let index = 0; index < source.length; index++) {
      signal?.throwIfAborted();
      await captureMutationRow(source, index, snapshot, counters);
      if (index % 128 === 0) await setImmediate();
    }
    signal?.throwIfAborted();
    return snapshot;
  } catch (error) {
    await snapshot.close();
    throw error;
  }
}
