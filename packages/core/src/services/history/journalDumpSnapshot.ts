/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
  /** The releases of rows a reader holds right now; close() lets them go. */
  private readonly held = new Set<() => void>();

  constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly resumeBoundary?: bigint,
    private readonly counters?: JournalReadCounters,
    private readonly onClose: () => void = () => {},
  ) {}

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
      this.snapshot.close();
      this.onClose();
    }
    return Promise.resolve();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Dump snapshot is closed');
  }
}
