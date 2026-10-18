/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { HistoryServiceEventEmitter } from './historyEventTypes.js';

export interface HistoryBatchCursor {
  next(): IteratorResult<IContent, void>;
  return(): IteratorResult<IContent, void>;
}
/**
 * The rows of a batch the journal store has already committed. They are read
 * after the event, one row at a time, from the version that was published when
 * the event fired, so a later mutation does not change what a listener reads
 * and nothing is held between reads. Each `rows()` call is an independent pass.
 */
export interface HistoryBatchRowSource {
  readonly length: number;
  rows(): AsyncGenerator<IContent, void, unknown>;
  /**
   * The dispatcher calls it once every listener has been handed the source.
   * The source holds a pin on its version while a listener may read it; after
   * `retire` the passes already started finish, then the pin is released, and a
   * pass started later throws.
   */
  retire(): void;
}
/**
 * What the old store's `contentBatchAdded` carries: the one row source
 * contract, plus the synchronous scoped reader the old listeners were written
 * against. `rows()` passes read through the same scoped cursor, so they work
 * only while the dispatcher keeps the scope open: it stays open until every pass
 * a listener started during dispatch has finished.
 */
export interface HistoryBatchValues extends HistoryBatchRowSource {
  withRows(execute: (cursor: HistoryBatchCursor) => undefined): void;
}
/** What `contentBatchAdded` carries. Both stores deliver a row source valid from dispatch until `retire()`; the union goes when the old store does. */
export type HistoryBatchEvent = HistoryBatchValues | HistoryBatchRowSource;
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
  private retired = false;
  private passes = 0;
  private readonly idleWaiters: Array<() => void> = [];
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

  async *rows(): AsyncGenerator<IContent, void, unknown> {
    const source = this.assertOpen();
    if (this.retired)
      throw new Error('The batch was retired; its rows can no longer be read');
    const cursor = new BatchCursor(
      source,
      this.start,
      this.end,
      this.ownership,
    );
    this.passes += 1;
    try {
      for (let item = cursor.next(); item.done !== true; item = cursor.next())
        yield item.value;
    } finally {
      cursor.return();
      this.passes -= 1;
      this.closeWhenIdle();
    }
  }

  /** Called by the dispatcher once every listener has the values; passes already started finish, then the scope closes. */
  retire(): void {
    this.retired = true;
    this.closeWhenIdle();
  }

  /** Settles when the scope is closed; undefined when it already is. */
  whenClosed(): Promise<void> | undefined {
    if (this.source === undefined) return undefined;
    return new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private closeWhenIdle(): void {
    if (!this.retired || this.passes > 0 || this.source === undefined) return;
    try {
      this.cursor?.return();
    } finally {
      this.cursor = undefined;
      this.source = undefined;
      this.ownership = undefined;
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
}

/**
 * Delivers the batch to `contentBatchAdded` listeners and retires it. When no
 * listener started a pass the scope is closed on return, as before. When one
 * did, the rows stay readable until it finishes, so the result is the promise
 * the caller must await before it releases `rows` (a listener failure is
 * rethrown by it; with no pass in flight it is thrown at once). A pass that never
 * finishes holds the publication, as an unfinished pass holds the journal's pin.
 */
export function emitHistoryBatchValues(
  history: HistoryServiceEventEmitter,
  rows: HistoryBatchRows,
  start = 0,
  ownership?: RowOwnership,
): Promise<void> | undefined {
  const values = new BatchValues(rows, start, ownership);
  let failure: { readonly error: unknown } | undefined;
  try {
    history.emit('contentBatchAdded', values);
  } catch (error) {
    failure = { error };
  }
  values.retire();
  const closed = values.whenClosed();
  if (closed === undefined) {
    if (failure !== undefined) throw failure.error;
    return undefined;
  }
  return closed.then(() => {
    if (failure !== undefined) throw failure.error;
  });
}
