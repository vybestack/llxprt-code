/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import type { DetachedHistoryAPI } from '@vybestack/llxprt-code-core/services/history/detachedHistoryAPI.js';
import { detachedValueSubmission } from '@vybestack/llxprt-code-core/services/history/detachedHistoryMutation.js';
import type { OwnedJournal } from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';

/** What the compression modules ask of a history, served by a JournalHistoryStore. */
export type JournalBackedHistory = Pick<
  HistoryService,
  'detachedValues' | 'setCacheAnchorSeq' | 'resetCacheAnchorSeq'
>;

/**
 * The detached API of a history whose store is the journal store of `owned`,
 * built the way `createDetachedHistoryAPI` builds it for any store, with no
 * mutation queue around it (a test runs one operation at a time).
 */
export function journalBackedHistory(
  owned: OwnedJournal,
): JournalBackedHistory {
  const { store, host } = owned;
  const enqueue = (execute: () => Promise<void>): Promise<void> => execute();
  const detachedValues: DetachedHistoryAPI = {
    withRollbackCheckpoint: (execute) =>
      store.withRollbackCheckpoint(host, enqueue, execute),
    withCheckpoint: (execute, signal) =>
      store.withCheckpoint(host, enqueue, execute, signal),
    append: (rows, model, options = {}) =>
      store.publishDetached(
        detachedValueSubmission(rows, undefined, true),
        host,
        model,
        { ...options, publishBatch: true },
      ),
    replace: (rows, model, options = {}) =>
      store.publishDetached(
        detachedValueSubmission(rows),
        host,
        model,
        options,
      ),
    transform: (transform, model, options = {}) =>
      store.publishDetached({ transform }, host, model, options),
  };
  return {
    detachedValues,
    setCacheAnchorSeq: () => {},
    resetCacheAnchorSeq: () => {},
  };
}

/**
 * A HistoryService whose detached API and dump snapshot are served by the
 * journal store of `owned`, for the compression routes (`runDiskHighDensity`,
 * `runDiskMiddleOut`, `runDiskOneShot`), which take a whole HistoryService. The
 * service's own store stays empty; it supplies the tokenizer and cache anchor.
 */
export function journalRoutedHistory(owned: OwnedJournal): HistoryService {
  const history = new HistoryService();
  const snapshot = (): HistoryDumpSnapshot => ({
    rows: () => owned.store.streamRows(),
    async *chronology() {},
    close: async () => {},
  });
  Object.defineProperty(history, 'detachedValues', {
    value: journalBackedHistory(owned).detachedValues,
  });
  Object.defineProperty(history, 'openDumpSnapshot', {
    value: async () => snapshot(),
  });
  return history;
}
