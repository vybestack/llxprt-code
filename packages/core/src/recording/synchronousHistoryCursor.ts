/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readSync } from 'node:fs';
import type { IContent } from '../services/history/IContent.js';
import { isSpeakerContent } from '../services/history/historyJournalGuards.js';
import type { PendingFoldSnapshot } from './pendingFoldSnapshot.js';
import type { JournalReadCounters } from './journalCounters.js';
import {
  foldLine,
  resolveRowContent,
  type PinnedFile,
} from './durableRowFold.js';
import { applyPending, pendingContent } from './pendingRowFold.js';

import { MutableRowDirectory, type NumericRow } from './mutableRowDirectory.js';
import { ResolverDiskIndex } from './resolverDiskIndex.js';
import { DurableDensityIndex } from './durableDensityIndex.js';
import { ProjectedLineReader } from './resolverScan.js';

export interface HistoryReadCursor {
  readonly length: number;
  isPendingRow(index: number): boolean;
  chronologySeqAt(index: number): number | undefined;
  rows(reverse?: boolean): Generator<IContent, void, unknown>;
}

function scanPrefix(
  pinned: PinnedFile,
  start: number,
  end: number,
  directory: MutableRowDirectory,
  staged: ResolverDiskIndex,
  density: DurableDensityIndex,
  projection: boolean,
  signal?: AbortSignal,
): void {
  if (pinned.size < end)
    throw new Error('Journal truncated below pinned watermark');
  const reader = new ProjectedLineReader(staged, false, density, start);
  const buffer = Buffer.alloc(64 * 1024);
  let position = start;
  while (position < end) {
    signal?.throwIfAborted();
    const count = readSync(
      pinned.fd,
      buffer,
      0,
      Math.min(buffer.length, end - position),
      position,
    );
    if (count === 0) throw new Error('Journal ended before pinned watermark');
    position += count;
    for (const line of reader.push(buffer.subarray(0, count)))
      foldLine(
        directory,
        line,
        staged,
        density,
        projection ? 'projection' : 'durable',
      );
  }
  for (const line of reader.finishTail())
    foldLine(
      directory,
      line,
      staged,
      density,
      projection ? 'projection' : 'durable',
    );
  signal?.throwIfAborted();
}

function foldSnapshot(
  snapshot: PendingFoldSnapshot,
  directory: MutableRowDirectory,
  staged: ResolverDiskIndex,
  density: DurableDensityIndex,
  signal?: AbortSignal,
): void {
  if (snapshot.durableTail > 0) {
    const journal = snapshot.pinnedJournal;
    if (journal === null)
      throw new Error('History cursor has no pinned journal');
    const boundary = snapshot.resumeBoundary;
    if (boundary < 0 || boundary > snapshot.durableTail)
      throw new RangeError('Invalid history cursor resume boundary');
    if (boundary > 0) {
      const projection = snapshot.pinnedProjection;
      scanPrefix(
        projection ?? journal,
        0,
        projection?.size ?? boundary,
        directory,
        staged,
        density,
        projection !== null,
        signal,
      );
      directory.transform((row) => ({ ...row, invalidateResponses: true }));
    }
    scanPrefix(
      journal,
      boundary,
      snapshot.durableTail,
      directory,
      staged,
      density,
      false,
      signal,
    );
  }
  for (let slot = 0; slot < snapshot.pendingLength; slot++) {
    signal?.throwIfAborted();
    applyPending(directory, snapshot.pending.read(slot).op, slot);
  }
}

function readRow(snapshot: PendingFoldSnapshot, row: NumericRow): IContent {
  if (row.source === 'pending') {
    if (row.pendingSlot >= snapshot.pendingLength)
      throw new Error('Pending cursor slot changed');
    return pendingContent(
      snapshot.pending.read(row.pendingSlot).op,
      row.offset,
    );
  }
  const pinned =
    row.source === 'projection'
      ? snapshot.pinnedProjection
      : snapshot.pinnedJournal;
  if (pinned === null) throw new Error('Missing pinned history row source');
  // Only the addressed row is decoded. A valid row can exceed the fixture byte gate.
  const bytes = Buffer.alloc(row.bytes);
  let consumed = 0;
  while (consumed < bytes.length) {
    const count = readSync(
      pinned.fd,
      bytes,
      consumed,
      bytes.length - consumed,
      row.offset + consumed,
    );
    if (count === 0) throw new Error('History row truncated');
    consumed += count;
  }
  const content: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isSpeakerContent(content)) throw new Error('Invalid pinned history row');
  return resolveRowContent(content, row);
}

class SynchronousHistoryCursor implements HistoryReadCursor {
  private closed = false;
  private readonly iterators = new Map<
    object,
    Generator<IContent, void, unknown>
  >();
  constructor(
    private readonly snapshot: PendingFoldSnapshot,
    private readonly directory: MutableRowDirectory,
    private readonly counters?: JournalReadCounters,
    private readonly signal?: AbortSignal,
  ) {}

  get length(): number {
    this.check();
    return this.directory.length;
  }

  isPendingRow(index: number): boolean {
    this.check();
    return this.directory.rowAt(index).source === 'pending';
  }

  chronologySeqAt(index: number): number | undefined {
    this.check();
    return this.directory.rowAt(index).chronologySeq ?? undefined;
  }

  private check(): void {
    if (this.closed) throw new Error('History read cursor is closed');
    this.signal?.throwIfAborted();
  }

  rows(reverse = false): Generator<IContent, void, unknown> {
    this.check();
    const rows = this.readRows(reverse);
    const iterators = this.iterators;
    const key = {};
    const iterator = (function* (): Generator<IContent, void, unknown> {
      try {
        yield* rows;
      } finally {
        iterators.delete(key);
      }
    })();
    this.iterators.set(key, iterator);
    return iterator;
  }

  private *readRows(reverse: boolean): Generator<IContent, void, unknown> {
    this.check();
    const step = reverse ? -1 : 1;
    for (
      let index = reverse ? this.length - 1 : 0;
      index >= 0 && index < this.length;
      index += step
    ) {
      this.check();
      const row = readRow(this.snapshot, this.directory.rowAt(index));
      this.counters?.rowDecoded();
      try {
        this.counters?.ownership?.retain(row);
        try {
          yield row;
          this.check();
        } finally {
          this.counters?.ownership?.release(row);
        }
      } finally {
        this.counters?.rowReleased();
      }
    }
    this.check();
  }

  close(): void {
    this.closed = true;
    try {
      for (const iterator of this.iterators.values()) iterator.return();
    } finally {
      this.iterators.clear();
    }
  }
}

/** Synchronous callback scope over the same projection and pending fold rules as streaming reads. */
export function withSynchronousHistoryCursor<T>(
  snapshot: PendingFoldSnapshot,
  execute: (cursor: HistoryReadCursor) => T,
  counters?: JournalReadCounters,
  signal?: AbortSignal,
): T {
  try {
    signal?.throwIfAborted();
    return executePinnedCursor(snapshot, execute, counters, signal);
  } finally {
    snapshot.release();
  }
}

export function captureHistoryOrdinalDirectory(
  snapshot: PendingFoldSnapshot,
): MutableRowDirectory {
  let directory: MutableRowDirectory | undefined;
  try {
    directory = new MutableRowDirectory();
    const staged = new ResolverDiskIndex();
    try {
      const density = new DurableDensityIndex();
      try {
        foldSnapshot(snapshot, directory, staged, density);
      } finally {
        density.close();
      }
    } finally {
      staged.close();
    }
    snapshot.release();
    return directory;
  } catch (error) {
    directory?.close();
    throw error;
  } finally {
    snapshot.release();
  }
}

function executePinnedCursor<T>(
  snapshot: PendingFoldSnapshot,
  execute: (cursor: HistoryReadCursor) => T,
  counters?: JournalReadCounters,
  signal?: AbortSignal,
): T {
  const directory = new MutableRowDirectory();
  try {
    const staged = new ResolverDiskIndex();
    try {
      const density = new DurableDensityIndex();
      try {
        foldSnapshot(snapshot, directory, staged, density, signal);
      } finally {
        density.close();
      }
    } finally {
      staged.close();
    }
    const cursor = new SynchronousHistoryCursor(
      snapshot,
      directory,
      counters,
      signal,
    );
    try {
      return execute(cursor);
    } finally {
      cursor.close();
    }
  } finally {
    directory.close();
  }
}
