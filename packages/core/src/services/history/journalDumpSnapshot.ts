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
import { HistoryReaderScope } from './historyReaderScope.js';

/**
 * The rows of one published version for a dump. Nothing is copied: each read
 * goes back to the file through the snapshot, one row at a time, so the dump
 * needs no spool and keeps its version however many groups commit after it.
 */
export class JournalDumpSnapshot implements HistoryDumpSnapshot {
  private readonly readers = new HistoryReaderScope('Dump snapshot is closed');
  private closing: Promise<void> | undefined;

  constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly resumeBoundary?: bigint,
    private readonly counters?: JournalReadCounters,
    private readonly onClose: () => void = () => {},
  ) {}

  get length(): number {
    this.readers.requireOpen();
    return this.snapshot.curatedRows;
  }

  readRow(index: number): Promise<IContent> {
    return this.readers.read(async () => {
      const entry = await this.snapshot.curatedAt(index);
      return decodeStoredRow(
        await this.snapshot.readRow(entry),
        this.resumeBoundary,
      );
    });
  }

  sourceOrdinalAt(index: number): Promise<number> {
    return this.readers.read(async () => {
      const entry = await this.snapshot.curatedAt(index);
      return this.snapshot.rowsBelow(entry.label);
    });
  }

  [Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
    return this.readers.open(this.curated());
  }

  private async *curated(): AsyncGenerator<IContent, void, unknown> {
    for (let index = 0; index < this.length; index++) {
      const row = await this.readRow(index);
      const release = countDecodedRow(row, this.counters);
      try {
        yield row;
      } finally {
        release();
      }
    }
  }

  rows(): AsyncGenerator<IContent, void, unknown> {
    return this.readers.open(this.raw());
  }

  private async *raw(): AsyncGenerator<IContent, void, unknown> {
    for await (const entry of this.snapshot.entries()) {
      this.readers.requireOpen();
      const row = decodeStoredRow(
        await this.snapshot.readRow(entry),
        this.resumeBoundary,
      );
      const release = countDecodedRow(row, this.counters);
      try {
        yield row;
      } finally {
        release();
      }
    }
  }

  async *chronology(): AsyncGenerator<ChronologyTraceEntry, void, unknown> {
    for await (const content of this.rows())
      yield* buildChronologyTrace([content]);
  }

  close(): Promise<void> {
    this.closing ??= this.retire();
    return this.closing;
  }

  private async retire(): Promise<void> {
    const failures: unknown[] = [];
    for (const close of [
      () => this.readers.close(),
      () => this.snapshot.close(),
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    this.onClose();
    if (failures.length > 0)
      throw new AggregateError(failures, 'Dump snapshot cleanup failed');
  }
}

export async function journalCompressionInput(this: {
  openDumpSnapshot(): Promise<JournalDumpSnapshot>;
}): Promise<CompressionInputSnapshot> {
  const dump = await this.openDumpSnapshot();
  return { previous: dump, rows: dump, close: () => dump.close() };
}
