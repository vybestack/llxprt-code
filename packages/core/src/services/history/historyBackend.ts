/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryServiceJournalOptions } from './historyBatchContracts.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import type { HistoryStorePort } from './historyStorePort.js';

/**
 * Temporary development seam (#854 phase 4). It lets the existing behaviour
 * suites run against the journal-backed store while the JSONL store is still
 * the default. The default flips in slice S13 and this file is deleted in S15.
 */
export const HISTORY_BACKEND_ENV = 'LLXPRT_HISTORY_BACKEND';

const BACKENDS = ['old', 'journal'] as const;

export type HistoryBackend = (typeof BACKENDS)[number];

export function selectBackend(
  env: Readonly<Record<string, string | undefined>> = process.env,
): HistoryBackend {
  const value = env[HISTORY_BACKEND_ENV];
  if (value === undefined) return 'old';
  const backend = BACKENDS.find((candidate) => candidate === value);
  if (backend === undefined)
    throw new Error(
      `${HISTORY_BACKEND_ENV} must be "old" or "journal", got ${JSON.stringify(value)}`,
    );
  return backend;
}

export function createHistoryStore(
  options: HistoryServiceJournalOptions,
  backend: HistoryBackend = selectBackend(),
): HistoryStorePort {
  if (backend === 'journal')
    throw new Error('The journal history backend is not implemented yet');
  return new HistoryJournalStore(
    options.recording,
    options.attachmentCounters,
    options.mutationOwnership,
  );
}
