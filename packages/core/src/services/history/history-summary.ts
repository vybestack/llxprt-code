/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import type { IContent } from './IContent.js';
import { awaitHistoryTask } from './history-export.js';
import { validateHistoryEntry } from './historyBatchContracts.js';

export interface HistorySummarySource extends Iterable<IContent> {
  readonly length: number;
}
export type HistorySummaryCallback = (
  source: HistorySummarySource,
  signal?: AbortSignal,
) => Promise<IContent>;

class ScopedSummaryRows implements HistorySummarySource {
  private closed = false;
  private readonly active = new Set<Generator<IContent, void, unknown>>();
  constructor(
    private readonly previous: HistoryMutationSnapshot,
    readonly length: number,
    private readonly signal?: AbortSignal,
  ) {}

  [Symbol.iterator](): Generator<IContent, void, unknown> {
    if (this.closed) throw new Error('Summary row source is closed');
    const iterator = this.rows();
    this.active.add(iterator);
    return iterator;
  }

  private *rows(): Generator<IContent, void, unknown> {
    let index = 0;
    for (const row of this.previous) {
      this.signal?.throwIfAborted();
      if (index++ >= this.length) return;
      yield row;
    }
  }

  close(): void {
    this.closed = true;
    for (const iterator of this.active) iterator.return();
    this.active.clear();
  }
}

async function runSummaryCallback(
  previous: HistoryMutationSnapshot,
  length: number,
  summarize: HistorySummaryCallback,
  signal?: AbortSignal,
): Promise<IContent> {
  const source = new ScopedSummaryRows(previous, length, signal);
  try {
    signal?.throwIfAborted();
    const summary = await awaitHistoryTask(summarize(source, signal), signal);
    signal?.throwIfAborted();
    validateHistoryEntry(summary, 0);
    return summary;
  } finally {
    source.close();
  }
}

export async function withSummaryRows(
  previous: HistoryMutationSnapshot,
  keepRecentCount: number,
  summarize: HistorySummaryCallback,
  publish: (candidate: HistoryDensityRows) => Promise<void>,
  ownership?: RowOwnership,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const keep = Number.isFinite(keepRecentCount)
    ? Math.max(0, Math.floor(keepRecentCount))
    : 0;
  if (previous.length <= keep) return;
  const start = previous.length - keep;
  const summary = await runSummaryCallback(previous, start, summarize, signal);
  const candidate = new HistoryDensityRows(ownership);
  try {
    candidate.appendIdentity(summary);
    let index = 0;
    for (const row of previous) {
      signal?.throwIfAborted();
      const pending = previous.isPendingRow(index);
      if (index++ < start) continue;
      if (pending) candidate.appendIdentity(row);
      else candidate.append(row);
    }
    signal?.throwIfAborted();
    await publish(candidate);
  } finally {
    candidate.close();
  }
}
