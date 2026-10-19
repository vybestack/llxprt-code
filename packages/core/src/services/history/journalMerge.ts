/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  detachedValueSubmission,
  type DetachedHistoryTransform,
} from './detachedHistoryMutation.js';
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

const appendDerivedRows: DetachedHistoryTransform = async (source, sink) => {
  let ordinal = 0;
  for await (const row of source.streamRows()) {
    if (isAcceptedHistoryValue(row)) await sink.appendDerived(ordinal, row);
    ordinal++;
  }
};

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
  if (request.source === store) {
    return store.publishDetached(
      { append: true, transform: appendDerivedRows },
      request.host,
      undefined,
      { publishBatch: true },
    );
  }
  const task = detachedValueSubmission(
    acceptedRows(request.source.streamRows()),
    request.ownership,
    true,
  );
  return store.publishDetached(task, request.host, undefined, {
    publishBatch: true,
  });
}
