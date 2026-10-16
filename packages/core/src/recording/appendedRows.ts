/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readSync } from 'node:fs';
import type { HistoryJournalOp } from '../services/history/historyStorePort.js';
import { foldLine } from './durableRowFold.js';
import { DurableDensityIndex } from './durableDensityIndex.js';
import { MutableRowDirectory, type NumericRow } from './mutableRowDirectory.js';
import type { PendingFoldSnapshot } from './pendingFoldSnapshot.js';
import { pendingRow } from './pendingRowFold.js';
import {
  contentTxId,
  HISTORY_RECORD_TYPES,
  REPLACE_RECORD_TYPES,
  ReplaceTransactionFold,
} from './replaceTransaction.js';
import { ResolverDiskIndex } from './resolverDiskIndex.js';
import { field } from './resolverProjection.js';
import { ProjectedLineReader, type ProjectedLine } from './resolverScan.js';

/**
 * Incremental view of a journal that only grew by whole content rows. A fold
 * that resumes from a saved summary may use these scans, because appended rows
 * cannot change any earlier row. Any record that can (rewind, compression,
 * density, insert, rebind, purge, or a replace transaction) is reported as not
 * append-only so the caller falls back to a full fold.
 */

function isMutation(line: ProjectedLine): boolean {
  if (line.invalid || line.blank || line.parsed === null) return false;
  const type = field(line.parsed, 'type');
  if (typeof type !== 'string') return false;
  if (REPLACE_RECORD_TYPES.has(type)) return true;
  if (type === 'content')
    return contentTxId(field(line.parsed, 'payload')) !== undefined;
  // A detail record annotates a compression and moves no row.
  if (type === 'compression_detail') return false;
  return HISTORY_RECORD_TYPES.has(type);
}

/**
 * The rows appended to the pinned journal in `[from, durableTail)`, as a
 * directory the caller owns, or null when that range holds any record that is
 * not a plain appended row. `from` must be a record boundary with no replace
 * transaction open.
 */
export function scanAppendedDurableRows(
  snapshot: PendingFoldSnapshot,
  from: number,
): MutableRowDirectory | null {
  const end = snapshot.durableTail;
  const journal = snapshot.pinnedJournal;
  if (journal === null) throw new Error('History cursor has no pinned journal');
  if (from > end) throw new RangeError('Appended range starts past the tail');
  if (journal.size < end)
    throw new Error('Journal truncated below pinned watermark');
  const rows = new MutableRowDirectory();
  try {
    if (from < end && !foldAppendedRange(journal.fd, from, end, rows)) {
      rows.close();
      return null;
    }
    return rows;
  } catch (error) {
    rows.close();
    throw error;
  }
}

function foldAppendedRange(
  fd: number,
  from: number,
  end: number,
  rows: MutableRowDirectory,
): boolean {
  const staged = new ResolverDiskIndex();
  try {
    const density = new DurableDensityIndex();
    try {
      return readAppendedLines(fd, from, end, rows, staged, density);
    } finally {
      density.close();
    }
  } finally {
    staged.close();
  }
}

function readAppendedLines(
  fd: number,
  from: number,
  end: number,
  rows: MutableRowDirectory,
  staged: ResolverDiskIndex,
  density: DurableDensityIndex,
): boolean {
  const reader = new ProjectedLineReader(staged, false, density, from);
  const tx = new ReplaceTransactionFold();
  const buffer = Buffer.alloc(64 * 1024);
  const accept = (lines: Iterable<ProjectedLine>): boolean => {
    for (const line of lines) {
      if (isMutation(line)) return false;
      foldLine(rows, line, staged, density, tx);
    }
    return true;
  };
  for (let position = from; position < end; ) {
    const count = readSync(
      fd,
      buffer,
      0,
      Math.min(buffer.length, end - position),
      position,
    );
    if (count === 0) throw new Error('Journal ended before pinned watermark');
    position += count;
    if (!accept(reader.push(buffer.subarray(0, count)))) return false;
  }
  return accept(reader.finishTail());
}

function isAppendOnlyOp(op: HistoryJournalOp): boolean {
  return (
    (op.kind === 'content' && op.tx === undefined) ||
    op.kind === 'compressionDetail'
  );
}

/** True when every pending operation only appends a row or annotates one. */
export function pendingIsAppendOnly(snapshot: PendingFoldSnapshot): boolean {
  for (let slot = 0; slot < snapshot.pendingLength; slot++)
    if (!isAppendOnlyOp(snapshot.pending.read(slot).op)) return false;
  return true;
}

/** The directory entries of the pending rows, in order. Requires {@link pendingIsAppendOnly}. */
export function* pendingAppendedRows(
  snapshot: PendingFoldSnapshot,
): Generator<NumericRow, void, undefined> {
  for (let slot = 0; slot < snapshot.pendingLength; slot++) {
    const op = snapshot.pending.read(slot).op;
    if (op.kind === 'content') yield pendingRow(op.content, slot);
    else if (op.kind !== 'compressionDetail')
      throw new Error('Pending operation is not append-only');
  }
}
