/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { PinnedRead } from './pinLease.js';
import type { RowEntry } from './rowEntry.js';
import { readStoredRow, type StoredRow } from './rowReads.js';
import { entryByLabel } from './rowTreeQueries.js';
import {
  entryAt,
  iterateRowEntries,
  type RowTreeRootRef,
} from './rowTreeReader.js';
import type { Version } from './version.js';
import type { SourceRow, VersionEdit } from './groupEdits.js';

/**
 * One published version with the reads that reach it. The version and the
 * access are taken together, so every read of a snapshot sees the same rows
 * however many groups commit after it was taken. It holds a trailer and a
 * reader, never a row. The snapshot holds the pin of its read until `close`,
 * so no compaction moves the records under it; a read after `close` throws.
 */
export class VersionSnapshot {
  constructor(
    private readonly read: PinnedRead,
    private readonly file: object = read,
  ) {}

  restorationIn(file: object): VersionEdit {
    this.read.requireOpen();
    const saved = this.version;
    if (saved === undefined) return { kind: 'clear' };
    return file === this.file
      ? { kind: 'restore', saved }
      : {
          kind: 'adoptAll',
          rows: this.sourceRows(),
          nextLabel: saved.nextLabel,
        };
  }

  private async *sourceRows(): AsyncGenerator<SourceRow> {
    for await (const entry of this.entries()) {
      yield { source: this.read.access, entry };
    }
  }

  /** Undefined for a journal with no committed group: no rows. */
  get version(): Version | undefined {
    return this.read.version;
  }

  /** Another hold on the snapshot's pin, for a reader that outlives its opener; the returned function releases it. */
  hold(): () => void | Promise<void> {
    return this.read.hold();
  }

  /** Releases the snapshot's pin. */
  close(): void | Promise<void> {
    return this.read.close();
  }

  /** The number of live rows. */
  get rows(): number {
    return this.read.version?.rows ?? 0;
  }

  /** The live rows in label order from index `from`. */
  async *entries(from = 0): AsyncGenerator<RowEntry> {
    const root = this.rootRef();
    if (root === undefined) return;
    yield* iterateRowEntries(this.read.access, root, from);
  }

  /** The `index`-th live row (0-based). */
  entryAt(index: number): Promise<RowEntry> {
    const root = this.rootRef();
    if (root === undefined) {
      throw new JournalFormatError(`Row ${index} of an empty snapshot`);
    }
    return entryAt(this.read.access, root, index);
  }

  /** The live row `label`, or undefined when no row has it. */
  entryByLabel(label: bigint): Promise<RowEntry | undefined> {
    return entryByLabel(this.read.access, this.rootRef(), label);
  }

  /** The whole row an entry of this snapshot points at. */
  readRow(entry: RowEntry): Promise<StoredRow> {
    return readStoredRow(this.read.access, entry);
  }

  private rootRef(): RowTreeRootRef | undefined {
    const { version } = this.read;
    return version === undefined || version.roots.rowRoot === 0
      ? undefined
      : { offset: version.roots.rowRoot, rows: version.rows };
  }
}
