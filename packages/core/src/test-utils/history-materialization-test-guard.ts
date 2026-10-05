/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '../services/history/HistoryService.js';
import { HistoryJournalStore } from '../services/history/historyJournalStore.js';

export function forbidHistoryMaterializationForTest(
  history: HistoryService,
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
