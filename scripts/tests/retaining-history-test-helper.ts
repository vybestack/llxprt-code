/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '../../packages/core/src/services/history/HistoryService.js';
import { HistoryJournalStore } from '../../packages/core/src/services/history/historyJournalStore.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';

// These negative controls must retain the full eager fold, not scoped rows.
export function retainHistoryForMemoryTrap(
  service: HistoryService,
): IContent[] {
  const journal: unknown = Reflect.get(service, 'journal');
  if (!(journal instanceof HistoryJournalStore))
    throw new Error('Memory trap requires the service journal');
  return journal.materialize();
}
