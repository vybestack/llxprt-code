/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryServiceJournalOptions } from './historyBatchContracts.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';
import {
  requireJournalRecorder,
  requireJsonlRecorder,
} from './recorderBackend.js';
import { selectBackend, type HistoryBackend } from './historyBackendSelect.js';
import type { HistoryStorePort } from './historyStorePort.js';

export function createHistoryStore(
  options: HistoryServiceJournalOptions,
  backend: HistoryBackend = selectBackend(),
): HistoryStorePort {
  if (backend === 'journal') {
    // The journal opens as the first step of the store's queue (D-W7-1): the
    // service constructor is synchronous. The bare store has no file to name.
    return new JournalHistoryStore(() => JournalSession.createUnlinked(), {
      recording:
        options.recording === undefined
          ? undefined
          : requireJournalRecorder(options.recording),
      counters: options.attachmentCounters,
    });
  }
  return new HistoryJournalStore(
    options.recording === undefined
      ? undefined
      : requireJsonlRecorder(options.recording),
    options.attachmentCounters,
    options.mutationOwnership,
  );
}
