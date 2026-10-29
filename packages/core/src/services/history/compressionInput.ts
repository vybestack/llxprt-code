/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent, ToolCallBlock } from './IContent.js';
import type { TokenRowInput } from './history-token-tickets.js';

export interface DensityCallLookup {
  firstCall(id: string): Promise<ToolCallBlock | undefined>;
  hasResponseAfter(id: string, position: number): Promise<boolean>;
}
import type { CompressionChronologySelection } from './compressionChronology.js';
import type { HistoryDumpSource } from './historyDumpSnapshot.js';

export interface CompressionRowSelection {
  readonly length: number;
  readRow(index: number): IContent | Promise<IContent>;
  readTokenRow?(index: number): TokenRowInput | Promise<TokenRowInput>;
  chronologySelection?(start: number): Promise<CompressionChronologySelection>;
}

export type CompressionIndexedRows = (
  | Iterable<IContent>
  | AsyncIterable<IContent>
) &
  CompressionRowSelection;

export type CompressionInputRows = CompressionIndexedRows & {
  readonly densityCalls?: DensityCallLookup;
  sourceOrdinalAt(
    index: number,
  ): number | undefined | Promise<number | undefined>;
};

export interface CompressionInputSnapshot {
  readonly previous: HistoryDumpSource;
  readonly rows: CompressionInputRows;
  close(): void | Promise<void>;
}
