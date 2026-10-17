/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { detachedValueSubmission } from './detachedHistoryMutation.js';
import type { HistoryMergeRequest } from './historyStorePort.js';
import { isAcceptedHistoryValue } from './historyValueEntries.js';
import type { IContent } from './IContent.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';

async function* acceptedRows(
  rows: AsyncIterable<IContent>,
): AsyncGenerator<IContent, void, unknown> {
  for await (const row of rows) {
    if (isAcceptedHistoryValue(row)) yield row;
  }
}

/**
 * Appends the source's accepted rows as one detached append (design 4.5): the
 * source is read one row at a time from the version it has acked and each row
 * goes straight to the target's group, so no copy of the source is held. An
 * append that took no row publishes nothing.
 */
export function mergeOnJournal(
  store: JournalHistoryStore,
  request: HistoryMergeRequest,
): Promise<void> {
  const task = detachedValueSubmission(
    acceptedRows(request.source.streamRows()),
    request.ownership,
    true,
  );
  return store.publishDetached(task, request.host, undefined, {
    publishBatch: true,
  });
}
