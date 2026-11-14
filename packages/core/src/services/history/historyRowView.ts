/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

/**
 * Row facts a mutation reads from a store while it runs inside the history
 * mutation queue. Every read is asynchronous so a store backed by a file can
 * serve it; the view is valid until the callback that received it settles.
 */
export interface HistoryRowView {
  readonly length: number;
  /** The origin id of the writer that owns row `index`; undefined if unowned. */
  originAt(index: number): Promise<string | undefined>;
  /** The chronology seq of row `index`; undefined if it has none. */
  chronologySeqAt(index: number): Promise<number | undefined>;
  /** The rows in order, one at a time. */
  rows(): AsyncGenerator<IContent, void, unknown>;
}
