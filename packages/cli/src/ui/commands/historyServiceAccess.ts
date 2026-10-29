/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ChronologyTraceEntry,
  IContent,
  HistoryDumpSnapshot,
} from '@vybestack/llxprt-code-core';
export interface HistoryServiceView {
  openDumpSnapshot(): Promise<HistoryDumpSnapshot>;
  getChronologyTrace: () => AsyncIterable<ChronologyTraceEntry>;
  streamRawHistory: (signal?: AbortSignal) => AsyncIterable<IContent>;
}
