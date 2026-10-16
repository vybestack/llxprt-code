/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '../packages/core/src/services/history/HistoryService.js';
import type { IContent } from '../packages/core/src/services/history/IContent.js';
import type { SessionPersistenceService } from '../packages/core/src/storage/SessionPersistenceService.js';

async function* acceptedProbeRow(
  history: HistoryService,
): AsyncGenerator<IContent, void, unknown> {
  let count = 0;
  for await (const row of history.streamRawHistory()) {
    count++;
    if (count > 1)
      throw new Error('Media probe requires exactly one history row');
    yield row;
  }
  if (count !== 1)
    throw new Error('Media probe requires exactly one history row');
}

export async function saveMediaProbeHistory(
  history: HistoryService,
  persistence: SessionPersistenceService,
  observePendingRow?: () => Promise<void>,
): Promise<number> {
  await persistence.saveRows(acceptedProbeRow(history), observePendingRow);
  return 1;
}

export async function countMediaProbeHistory(
  history: HistoryService,
): Promise<number> {
  let count = 0;
  for await (const row of history.streamRawHistory()) {
    void row;
    count++;
  }
  return count;
}
