/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import { withSynchronousHistoryCursor } from '../../recording/synchronousHistoryCursor.js';
import type { IContent } from './IContent.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import {
  buildChronologyTrace,
  type ChronologyTraceEntry,
} from './historyChronology.js';

class ValueDumpSnapshot implements HistoryDumpSnapshot {
  private closed = false;
  private readonly readers = new Map<
    object,
    AsyncGenerator<IContent, void, unknown>
  >();

  constructor(
    private readonly values: HistoryDensityRows,
    private readonly counters?: JournalReadCounters,
  ) {}

  rows(): AsyncGenerator<IContent, void, unknown> {
    this.assertOpen();
    const key = {};
    const reader = this.readValues(key);
    this.readers.set(key, reader);
    return reader;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Dump snapshot is closed');
  }

  private async *readValues(
    key: object,
  ): AsyncGenerator<IContent, void, unknown> {
    try {
      this.assertOpen();
      for (let index = 0; index < this.values.length; index++) {
        this.assertOpen();
        yield* this.readValue(index);
      }
    } finally {
      this.readers.delete(key);
    }
  }

  private async *readValue(
    index: number,
  ): AsyncGenerator<IContent, void, unknown> {
    const content = this.values.readRow(index);
    this.counters?.rowDecoded();
    try {
      this.counters?.ownership?.retain(content);
      try {
        yield content;
      } finally {
        this.counters?.ownership?.release(content);
      }
    } finally {
      this.counters?.rowReleased();
    }
  }

  async *chronology(): AsyncIterable<ChronologyTraceEntry> {
    for await (const content of this.rows())
      yield* buildChronologyTrace([content]);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      for (const reader of this.readers.values()) await reader.return();
    } finally {
      this.readers.clear();
      this.values.close();
    }
  }
}

export function captureHistoryDumpValues(
  captured: PendingFoldSnapshot,
  counters?: JournalReadCounters,
): HistoryDumpSnapshot {
  return withSynchronousHistoryCursor(
    captured,
    (cursor) => {
      const values = new HistoryDensityRows();
      try {
        for (const content of cursor.rows()) values.append(content);
        const snapshot = new ValueDumpSnapshot(values, counters);
        return {
          rows: () => snapshot.rows(),
          chronology: () => snapshot.chronology(),
          close: () => snapshot.close(),
        };
      } catch (error) {
        values.close();
        throw error;
      }
    },
    counters,
  );
}
