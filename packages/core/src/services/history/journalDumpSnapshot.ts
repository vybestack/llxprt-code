/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { CompressionInputSnapshot } from './compressionInput.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import {
  buildChronologyTrace,
  type ChronologyTraceEntry,
} from './historyChronology.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import { countDecodedRow } from './journalRowCounters.js';
import { decodeStoredRow } from './journalRowCodec.js';

/**
 * The rows of one published version for a dump. Nothing is copied: each read
 * goes back to the file through the snapshot, one row at a time, so the dump
 * needs no spool and keeps its version however many groups commit after it.
 */
export class JournalDumpSnapshot implements HistoryDumpSnapshot {
  private closed = false;
  private closing: Promise<void> | undefined;
  /** The releases of rows a reader holds right now; close() lets them go. */
  private readonly held = new Set<() => void>();

  constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly resumeBoundary?: bigint,
    private readonly counters?: JournalReadCounters,
    private readonly onClose: () => void = () => {},
  ) {}

  get length(): number {
    this.assertOpen();
    return this.snapshot.curatedRows;
  }

  async readRow(index: number): Promise<IContent> {
    this.assertOpen();
    const entry = await this.snapshot.curatedAt(index);
    const row = decodeStoredRow(
      await this.snapshot.readRow(entry),
      this.resumeBoundary,
    );
    this.assertOpen();
    return row;
  }

  async sourceOrdinalAt(index: number): Promise<number> {
    this.assertOpen();
    const entry = await this.snapshot.curatedAt(index);
    const ordinal = await this.snapshot.rowsBelow(entry.label);
    this.assertOpen();
    return ordinal;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
    for (let index = 0; index < this.length; index++) {
      const row = await this.readRow(index);
      const release = this.hold(countDecodedRow(row, this.counters));
      try {
        yield row;
      } finally {
        release();
      }
    }
  }

  async *rows(): AsyncGenerator<IContent, void, unknown> {
    this.assertOpen();
    for await (const entry of this.snapshot.entries()) {
      this.assertOpen();
      const row = decodeStoredRow(
        await this.snapshot.readRow(entry),
        this.resumeBoundary,
      );
      const release = this.hold(countDecodedRow(row, this.counters));
      try {
        yield row;
      } finally {
        release();
      }
    }
    this.assertOpen();
  }

  /** The release of a held row, which runs once whichever of the reader and close() comes first. */
  private hold(release: () => void): () => void {
    const once = (): void => {
      if (this.held.delete(once)) release();
    };
    this.held.add(once);
    return once;
  }

  async *chronology(): AsyncGenerator<ChronologyTraceEntry, void, unknown> {
    for await (const content of this.rows())
      yield* buildChronologyTrace([content]);
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      for (const release of [...this.held]) release();
      this.closing = Promise.resolve(this.snapshot.close()).finally(
        this.onClose,
      );
    }
    return this.closing ?? Promise.resolve();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Dump snapshot is closed');
  }
}

export async function journalCompressionInput(this: {
  openDumpSnapshot(): Promise<JournalDumpSnapshot>;
}): Promise<CompressionInputSnapshot> {
  const dump = await this.openDumpSnapshot();
  return { previous: dump, rows: dump, close: () => dump.close() };
}
