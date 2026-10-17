/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryServiceJournalOptions } from './historyBatchContracts.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { requireJsonlRecorder } from './recorderBackend.js';
import { selectBackend, type HistoryBackend } from './historyBackendSelect.js';
import type { HistoryStorePort } from './historyStorePort.js';

export function createHistoryStore(
  options: HistoryServiceJournalOptions,
  backend: HistoryBackend = selectBackend(),
): HistoryStorePort {
  if (backend === 'journal')
    throw new Error('The journal history backend is not implemented yet');
  return new HistoryJournalStore(
    options.recording === undefined
      ? undefined
      : requireJsonlRecorder(options.recording),
    options.attachmentCounters,
    options.mutationOwnership,
  );
}
