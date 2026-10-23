/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryServiceJournalOptions } from './historyBatchContracts.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';
import { requireJournalRecorder } from './recorderBackend.js';

export function createHistoryStore(
  options: HistoryServiceJournalOptions,
): JournalHistoryStore {
  return new JournalHistoryStore(() => JournalSession.createUnlinked(), {
    recording:
      options.recording === undefined
        ? undefined
        : requireJournalRecorder(options.recording),
    counters: options.attachmentCounters,
  });
}
