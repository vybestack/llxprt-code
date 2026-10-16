/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryJournalStore } from '@vybestack/llxprt-code-core/services/history/historyJournalStore.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

// TEST ONLY: sample the current journal in this turn, including pending identities.
export function observeHistorySynchronouslyForTest(service: {
  streamRawHistory(): AsyncIterable<IContent>;
}): IContent[] {
  const journal: unknown = Reflect.get(service, 'journal');
  if (!(journal instanceof HistoryJournalStore)) {
    throw new Error(
      'Synchronous test observation requires the service journal',
    );
  }
  return journal.materialize();
}
