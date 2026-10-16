/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import {
  buildChronologyTrace,
  type ChronologyTraceEntry,
} from './historyChronology.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import { decodeStoredRow } from './journalRowCodec.js';

/**
 * The rows of one published version for a dump. Nothing is copied: each read
 * goes back to the file through the snapshot, one row at a time, so the dump
 * needs no spool and keeps its version however many groups commit after it.
 */
export class JournalDumpSnapshot implements HistoryDumpSnapshot {
  private closed = false;

  constructor(private readonly snapshot: VersionSnapshot) {}

  async *rows(): AsyncGenerator<IContent, void, unknown> {
    this.assertOpen();
    for await (const entry of this.snapshot.entries()) {
      this.assertOpen();
      yield decodeStoredRow(await this.snapshot.readRow(entry));
    }
    this.assertOpen();
  }

  async *chronology(): AsyncGenerator<ChronologyTraceEntry, void, unknown> {
    for await (const content of this.rows())
      yield* buildChronologyTrace([content]);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Dump snapshot is closed');
  }
}
