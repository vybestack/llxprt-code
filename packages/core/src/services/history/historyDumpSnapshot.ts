/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { NativeFactIndexRegistration } from '../../journal/nativeFactIndex.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { ProviderRequestRows } from './provider-request-snapshot.js';
import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import type { IContent } from './IContent.js';
import type {
  CompressionChronologySelection,
  CompressionSpanAnnotation,
} from './compressionChronology.js';
import type { ChronologyTraceEntry } from './historyChronology.js';
import { captureHistoryDumpValues } from './dumpSnapshotValues.js';

export interface HistoryDumpSource {
  readonly callerOwnedRows?: ProviderRequestRows;
  rows(): AsyncIterable<IContent>;
  withRawFacts?<T>(
    registration: NativeFactIndexRegistration,
    consume: (snapshot: VersionSnapshot) => Promise<T>,
  ): Promise<T>;
  rawChatFacts?(): Promise<{
    readonly lastThinking: number;
    readonly hasCalls: boolean;
  }>;
  readRawRow?(index: number): Promise<IContent>;
  compressionSpan?(
    selection: CompressionChronologySelection,
    hasFrontier: boolean,
    signal?: AbortSignal,
  ): Promise<CompressionSpanAnnotation>;
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
