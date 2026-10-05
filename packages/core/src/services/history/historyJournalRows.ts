/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import {
  foldPendingRows,
  type PendingRowFold,
} from '../../recording/pendingRowFold.js';
import type { IContent } from './IContent.js';

function retainRow(
  content: IContent,
  counters?: JournalReadCounters,
): () => void {
  for (const block of content.blocks) {
    if (
      block.type === 'media' &&
      block.encoding === 'reference' &&
      block.providerFiles !== undefined
    ) {
      for (const reference of block.providerFiles) Object.freeze(reference);
      Object.freeze(block.providerFiles);
    }
  }
  counters?.rowDecoded();
  try {
    counters?.ownership?.retain(content);
  } catch (error) {
    counters?.rowReleased();
    throw error;
  }
  return () => {
    counters?.ownership?.release(content);
    counters?.rowReleased();
  };
}

async function* streamCapturedRows(
  capture: () => PendingFoldSnapshot,
  counters?: JournalReadCounters,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  signal?.throwIfAborted();
  const fold = await foldPendingRows(capture());
  try {
    signal?.throwIfAborted();
    for (let index = 0; index < fold.length; index += 1) {
      signal?.throwIfAborted();
      const content = await fold.readRow(index);
      const release = retainRow(content, counters);
      try {
        signal?.throwIfAborted();
        yield content;
      } finally {
        release();
      }
    }
    signal?.throwIfAborted();
  } finally {
    await fold.close();
  }
}

/** Create a cold stream whose journal snapshot is captured by its first next(). */
export function streamHistoryJournalRows(
  capture: () => PendingFoldSnapshot,
  counters?: JournalReadCounters,
  query?: HistorySuffixQuery,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  return query === undefined
    ? streamCapturedRows(capture, counters, signal)
    : streamHistoryJournalSuffix(capture, query, counters, signal);
}

export type HistorySuffixQuery =
  | { readonly kind: 'recent'; readonly count: number }
  | {
      readonly kind: 'tokens';
      readonly maxTokens: number;
      readonly countTokens: (content: IContent) => number;
    };

function recentStart(length: number, count: number): number {
  const start = -Math.trunc(count);
  if (Number.isNaN(start)) return 0;
  return start < 0 ? Math.max(length + start, 0) : Math.min(start, length);
}

async function countRowTokens(
  fold: PendingRowFold,
  index: number,
  query: Extract<HistorySuffixQuery, { kind: 'tokens' }>,
  counters?: JournalReadCounters,
  signal?: AbortSignal,
): Promise<number> {
  const content = await fold.readRow(index);
  const release = retainRow(content, counters);
  try {
    signal?.throwIfAborted();
    const tokens = query.countTokens(content);
    signal?.throwIfAborted();
    return tokens;
  } finally {
    release();
  }
}

async function tokenSuffixStart(
  fold: PendingRowFold,
  query: Extract<HistorySuffixQuery, { kind: 'tokens' }>,
  counters?: JournalReadCounters,
  signal?: AbortSignal,
): Promise<number> {
  let start = fold.length;
  let total = 0;
  while (start > 0) {
    signal?.throwIfAborted();
    const tokens = await countRowTokens(
      fold,
      start - 1,
      query,
      counters,
      signal,
    );
    if (!(total + tokens <= query.maxTokens)) break;
    total += tokens;
    start -= 1;
  }
  return start;
}

/** Reverse selection and forward output share one pinned disk-backed row directory. */
export async function* streamHistoryJournalSuffix(
  capture: () => PendingFoldSnapshot,
  query: HistorySuffixQuery,
  counters?: JournalReadCounters,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  signal?.throwIfAborted();
  const fold = await foldPendingRows(capture());
  try {
    signal?.throwIfAborted();
    const start =
      query.kind === 'recent'
        ? recentStart(fold.length, query.count)
        : await tokenSuffixStart(fold, query, counters, signal);
    for (let index = start; index < fold.length; index++) {
      signal?.throwIfAborted();
      const content = await fold.readRow(index);
      const release = retainRow(content, counters);
      try {
        signal?.throwIfAborted();
        yield content;
      } finally {
        release();
      }
    }
    signal?.throwIfAborted();
  } finally {
    await fold.close();
  }
}
