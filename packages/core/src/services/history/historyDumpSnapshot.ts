/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import type { IContent } from './IContent.js';
import type { ChronologyTraceEntry } from './historyChronology.js';
import { captureHistoryDumpValues } from './dumpSnapshotValues.js';

export interface HistoryDumpSource {
  rows(): AsyncIterable<IContent>;
}
export interface HistoryDumpSnapshot extends HistoryDumpSource {
  chronology(): AsyncIterable<ChronologyTraceEntry>;
  close(): Promise<void>;
}

export async function openHistoryDumpSnapshot(
  captured: PendingFoldSnapshot,
  counters?: JournalReadCounters,
): Promise<HistoryDumpSnapshot> {
  return captureHistoryDumpValues(captured, counters);
}
