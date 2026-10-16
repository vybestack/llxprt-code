/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import { readStoredRow, type StoredRow } from './rowReads.js';
import {
  entryAt,
  iterateRowEntries,
  type RowTreeRootRef,
} from './rowTreeReader.js';
import type { Version } from './version.js';

/**
 * One published version with the reads that reach it. The version and the
 * access are taken together, so every read of a snapshot sees the same rows
 * however many groups commit after it was taken. It holds a trailer and a
 * reader, never a row.
 */
export class VersionSnapshot {
  /** `version` is undefined for a journal with no committed group: no rows. */
  constructor(
    readonly version: Version | undefined,
    private readonly access: RecordAccess | undefined,
  ) {}

  /** The number of live rows. */
  get rows(): number {
    return this.version?.rows ?? 0;
  }

  /** The live rows in label order from index `from`. */
  async *entries(from = 0): AsyncGenerator<RowEntry> {
    const root = this.rootRef();
    if (root === undefined) return;
    yield* iterateRowEntries(this.requireAccess(), root, from);
  }

  /** The `index`-th live row (0-based). */
  entryAt(index: number): Promise<RowEntry> {
    const root = this.rootRef();
    if (root === undefined) {
      throw new JournalFormatError(`Row ${index} of an empty snapshot`);
    }
    return entryAt(this.requireAccess(), root, index);
  }

  /** The whole row an entry of this snapshot points at. */
  readRow(entry: RowEntry): Promise<StoredRow> {
    return readStoredRow(this.requireAccess(), entry);
  }

  private rootRef(): RowTreeRootRef | undefined {
    const version = this.version;
    return version === undefined || version.roots.rowRoot === 0
      ? undefined
      : { offset: version.roots.rowRoot, rows: version.rows };
  }

  private requireAccess(): RecordAccess {
    if (this.access === undefined) {
      throw new JournalFormatError('The snapshot has no committed group');
    }
    return this.access;
  }
}
