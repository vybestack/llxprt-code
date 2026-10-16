/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { HistoryServiceEventEmitter } from './historyEventTypes.js';

export interface HistoryBatchCursor {
  next(): IteratorResult<IContent, void>;
  return(): IteratorResult<IContent, void>;
}
export interface HistoryBatchValues {
  readonly length: number;
  withRows(execute: (cursor: HistoryBatchCursor) => undefined): void;
}
export interface HistoryBatchRows {
  readonly length: number;
  readRow(ordinal: number): IContent;
}

class BatchCursor implements HistoryBatchCursor {
  private current: IContent | undefined;
  private source: HistoryBatchRows | undefined;
  private ownership: RowOwnership | undefined;
  private ordinal: number;

  constructor(
    source: HistoryBatchRows,
    start: number,
    private readonly end: number,
    ownership?: RowOwnership,
  ) {
    this.source = source;
    this.ordinal = start;
    this.ownership = ownership;
  }

  private release(): void {
    if (this.current !== undefined) this.ownership?.release(this.current);
    this.current = undefined;
  }

  next(): IteratorResult<IContent, void> {
    const source = this.source;
    if (source === undefined) throw new Error('History batch cursor is closed');
    this.release();
    if (this.ordinal === this.end) return { done: true, value: undefined };
    try {
      const row = source.readRow(this.ordinal++);
      this.ownership?.retain(row);
      this.current = row;
      return { done: false, value: row };
    } catch (error) {
      this.return();
      throw error;
    }
  }

  return(): IteratorResult<IContent, void> {
    try {
      this.release();
    } finally {
      this.source = undefined;
      this.ownership = undefined;
    }
    return { done: true, value: undefined };
  }
}

class BatchValues implements HistoryBatchValues {
  private source: HistoryBatchRows | undefined;
  private ownership: RowOwnership | undefined;
  private cursor: BatchCursor | undefined;
  private readonly end: number;

  constructor(
    source: HistoryBatchRows,
    private readonly start: number,
    ownership?: RowOwnership,
  ) {
    this.source = source;
    this.end = source.length;
    this.ownership = ownership;
  }

  private assertOpen(): HistoryBatchRows {
    if (this.source === undefined)
      throw new Error('History batch values are closed');
    return this.source;
  }

  get length(): number {
    this.assertOpen();
    return this.end - this.start;
  }

  withRows(execute: (cursor: HistoryBatchCursor) => undefined): void {
    const source = this.assertOpen();
    if (this.cursor !== undefined)
      throw new Error('History batch cursor is already active');
    const cursor = new BatchCursor(
      source,
      this.start,
      this.end,
      this.ownership,
    );
    this.cursor = cursor;
    const read: (cursor: HistoryBatchCursor) => unknown = execute;
    try {
      if (read(cursor) !== undefined)
        throw new Error(
          'History batch reader must be synchronous and return undefined',
        );
    } finally {
      try {
        cursor.return();
      } finally {
        this.cursor = undefined;
      }
    }
  }

  close(): void {
    try {
      this.cursor?.return();
    } finally {
      this.cursor = undefined;
      this.source = undefined;
      this.ownership = undefined;
    }
  }
}

export function emitHistoryBatchValues(
  history: HistoryServiceEventEmitter,
  rows: HistoryBatchRows,
  start = 0,
  ownership?: RowOwnership,
): void {
  const values = new BatchValues(rows, start, ownership);
  try {
    history.emit('contentBatchAdded', values);
  } finally {
    values.close();
  }
}
