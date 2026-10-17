/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
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
