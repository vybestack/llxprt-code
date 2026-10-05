/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { applyCompressionValuesWithAnchor } from './cache-anchor-values.js';

async function publishValues(
  history: HistoryService,
  candidate: HistoryDensityRows,
  top: number,
  model: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const previous = await history.openDumpSnapshot();
    try {
      await applyCompressionValuesWithAnchor(
        history,
        previous,
        candidate,
        0,
        model,
        top,
        {
          signal,
          publishTokens: true,
        },
      );
    } finally {
      await previous.close();
    }
  } finally {
    candidate.close();
  }
}

export function publishCompressionArrayValues(
  history: HistoryService,
  rows: readonly IContent[],
  top: number,
  model: string,
  signal?: AbortSignal,
): Promise<void> {
  let candidate: HistoryDensityRows | undefined;
  try {
    signal?.throwIfAborted();
    candidate = new HistoryDensityRows();
    for (const row of rows) {
      signal?.throwIfAborted();
      candidate.append(row);
    }
  } catch (error) {
    try {
      candidate?.close();
    } catch (cleanup) {
      return Promise.reject(
        new AggregateError(
          [error, cleanup],
          'Compression value capture and cleanup failed',
        ),
      );
    }
    return Promise.reject(error);
  }
  return publishValues(history, candidate, top, model, signal);
}
