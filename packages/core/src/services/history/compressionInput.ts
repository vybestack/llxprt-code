/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { CompressionChronologySelection } from './compressionChronology.js';
import type { HistoryDumpSource } from './historyDumpSnapshot.js';

export type CompressionIndexedRows = (
  | Iterable<IContent>
  | AsyncIterable<IContent>
) & {
  readonly length: number;
  readRow(index: number): IContent | Promise<IContent>;
  chronologySelection?(start: number): Promise<CompressionChronologySelection>;
};

export type CompressionInputRows = CompressionIndexedRows & {
  sourceOrdinalAt(
    index: number,
  ): number | undefined | Promise<number | undefined>;
};

export interface CompressionInputSnapshot {
  readonly previous: HistoryDumpSource;
  readonly rows: CompressionInputRows;
  close(): void | Promise<void>;
}
