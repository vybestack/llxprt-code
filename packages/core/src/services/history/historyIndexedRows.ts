/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

export interface HistoryIndexedRows extends Iterable<IContent> {
  readonly length: number;
  readRow(index: number): IContent;
  writeRow?(index: number, row: IContent): void;
}

export type HistoryRowSource = readonly IContent[] | HistoryIndexedRows;

export function historyRowAt(rows: HistoryRowSource, index: number): IContent {
  return 'readRow' in rows ? rows.readRow(index) : rows[index];
}
