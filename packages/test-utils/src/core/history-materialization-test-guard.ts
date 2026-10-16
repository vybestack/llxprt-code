/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryJournalStore } from '@vybestack/llxprt-code-core/services/history/historyJournalStore.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export function forbidHistoryMaterializationForTest(
  history: { streamRawHistory(): AsyncIterable<IContent> },
  message = 'eager history materialization forbidden',
  forbidden: () => boolean = () => true,
): () => void {
  const journal: unknown = Reflect.get(history, 'journal');
  if (!(journal instanceof HistoryJournalStore)) {
    throw new Error('Materialization guard requires the service journal');
  }
  const original = journal.materialize;
  journal.materialize = () => {
    if (forbidden()) throw new Error(message);
    return original.call(journal);
  };
  return () => {
    journal.materialize = original;
  };
}
