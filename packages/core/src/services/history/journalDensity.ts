/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryDensityRows } from './historyDensityRows.js';
import type { HistoryDensityRequest } from './historyStorePort.js';
import { diskDensityTransform } from './historyValueEntries.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import { retryWithBackoff } from '../../utils/retry.js';
import { shouldRetryCompressionError } from '../../core/compression/types.js';

/**
 * The optimizer reads rows by index, so the durable rows are copied once into
 * a scratch candidate for it (a per-operation file the agents compression
 * modules also build today, WIRING G13). Its decisions then stream into one
 * detached transform over the same version, which keeps each replaced row's
 * chronology marker and records the density spans. A pass that decides
 * nothing publishes nothing.
 */
export async function optimizeDensityOnJournal(
  store: JournalHistoryStore,
  request: HistoryDensityRequest,
): Promise<void> {
  await request.host.waitForTokenUpdates();
  const rows = new HistoryDensityRows(request.ownership);
  try {
    for await (const row of store.streamRows()) rows.append(row);
    const result = request.optimize(rows);
    try {
      if (result.removalCount === 0 && result.replacementCount === 0) return;
      await store.publishDetached(
        { transform: diskDensityTransform(result, request.ownership) },
        {
          ...request.host,
          estimate: (contents, model, signal) =>
            retryWithBackoff(
              () => request.host.estimate(contents, model, signal),
              {
                maxAttempts: 3,
                initialDelayMs: 2000,
                maxDelayMs: 10000,
                shouldRetryOnError: shouldRetryCompressionError,
                signal,
              },
            ),
        },
        undefined,
        { publishTokens: true, densityShape: true },
      );
    } finally {
      result.close();
    }
  } finally {
    rows.close();
  }
}
