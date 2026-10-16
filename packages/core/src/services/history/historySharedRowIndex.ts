/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DurableDensityIndex } from '../../recording/durableDensityIndex.js';
import { foldLine } from '../../recording/durableRowFold.js';
import {
  MutableRowDirectory,
  type NumericRow,
} from '../../recording/mutableRowDirectory.js';
import { ResolverDiskIndex } from '../../recording/resolverDiskIndex.js';
import { ProjectedLineReader } from '../../recording/resolverScan.js';
import { ReplaceTransactionFold } from '../../recording/replaceTransaction.js';
import { RowOriginDictionary } from '../../recording/rowOriginDictionary.js';
import type { ScannedJournalRecord } from './historyJournalRecordScan.js';

/** How many shared rows each origin owns; `unowned` rows belong to every origin. */
export class OwnerCounts {
  constructor(
    private readonly unowned: number,
    private readonly owned: ReadonlyMap<number, number>,
  ) {}

  /** The rows a mirror of `originId` holds: its own plus the unowned ones. */
  heldBy(originId: number): number {
    return this.unowned + (this.owned.get(originId) ?? 0);
  }
}

/** True when a mirror of `mirrorId` holds a row owned by `rowOrigin` (0 is unowned). */
export function mirrorHolds(
  mirrorId: number,
  rowOrigin: number | undefined,
): boolean {
  return rowOrigin === undefined || rowOrigin === mirrorId;
}

/**
 * The shared history as the fan-out pump sees it: one fixed-width disk row
 * per shared row holding where the row sits in the hidden primary journal,
 * its chronology marker and the id of its owner. Row contents are never held
 * in memory; they are read back from the journal one row at a time.
 *
 * The index is folded one committed record at a time with the same fold every
 * durable reader uses, so it equals the union of the mirrors. Between records
 * it holds a few scalars and the dictionary of distinct origin ids.
 */
export class SharedRowIndex {
  private readonly directory = new MutableRowDirectory();
  private readonly staged: ResolverDiskIndex;
  private readonly density: DurableDensityIndex;
  private readonly tx = new ReplaceTransactionFold();
  private readonly origins = new RowOriginDictionary();
  /** Where the next row of an open replace transaction looks for its predecessor. */
  private inheritFrom = 0;
  private failure: unknown;
  private closed = false;

  constructor() {
    try {
      this.staged = new ResolverDiskIndex();
      try {
        this.density = new DurableDensityIndex();
      } catch (error) {
        this.staged.close();
        throw error;
      }
    } catch (error) {
      this.directory.close();
      throw error;
    }
  }

  get length(): number {
    return this.directory.length;
  }

  rowAt(index: number): NumericRow {
    return this.directory.rowAt(index);
  }

  firstChronology(seq: number): number {
    return this.directory.firstChronology(seq);
  }

  rows(): Generator<NumericRow, void, undefined> {
    return this.directory.rows();
  }

  /** The dictionary id of an origin; 0 stands for no origin. */
  idOf(origin: string | undefined): number {
    return this.origins.idOf(origin);
  }

  originOf(id: number | undefined): string | undefined {
    return this.origins.originOf(id);
  }

  counts(): OwnerCounts {
    let unowned = 0;
    const owned = new Map<number, number>();
    for (const row of this.directory.rows()) {
      if (row.origin === undefined) unowned++;
      else owned.set(row.origin, (owned.get(row.origin) ?? 0) + 1);
    }
    return new OwnerCounts(unowned, owned);
  }

  /**
   * Fold one committed record written by `owner`. A failed fold leaves the
   * index half applied, so every later use rethrows it.
   */
  fold(record: ScannedJournalRecord, owner: string | undefined): void {
    this.assertUsable();
    try {
      const ownerId = this.idOf(owner);
      const lengthBefore = this.directory.length;
      if (record.type === 'replace_begin') this.inheritFrom = 0;
      const reader = new ProjectedLineReader(
        this.staged,
        false,
        this.density,
        record.start,
      );
      for (const line of reader.push(record.raw)) this.foldLine(line, ownerId);
      for (const line of reader.finishTail()) this.foldLine(line, ownerId);
      if (
        record.type === 'content' &&
        ownerId === 0 &&
        this.directory.length === lengthBefore + 1
      )
        this.inheritTransactionOwner();
    } catch (error) {
      this.failure = error;
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.directory.close();
    } finally {
      try {
        this.staged.close();
      } finally {
        this.density.close();
      }
    }
  }

  private foldLine(
    line: Parameters<typeof foldLine>[1],
    ownerId: number,
  ): void {
    foldLine(
      this.directory,
      line,
      this.staged,
      this.density,
      this.tx,
      'durable',
      ownerId,
    );
  }

  /**
   * A row written into a replace transaction by a writer that names no owner
   * is a rewrite of a row the transaction replaces, so it keeps that row's
   * owner. Rewritten rows come in order, which keeps the search linear.
   */
  private inheritTransactionOwner(): void {
    const open = this.tx.open;
    const last = this.directory.length - 1;
    if (open === null || last < open.base) return;
    const row = this.directory.rowAt(last);
    if (row.origin !== undefined || row.chronologySeq === null) return;
    for (let index = this.inheritFrom; index < open.base; index++) {
      const base = this.directory.rowAt(index);
      if (base.chronologySeq !== row.chronologySeq) continue;
      this.inheritFrom = index + 1;
      if (base.origin !== undefined)
        this.directory.replace(last, { ...row, origin: base.origin });
      return;
    }
  }

  private assertUsable(): void {
    if (this.closed) throw new Error('Shared row index is closed');
    if (this.failure !== undefined)
      throw new Error('Shared row index failed to fold an earlier record', {
        cause: this.failure,
      });
  }
}
