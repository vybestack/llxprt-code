/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { withDetachedHistoryCheckpoint } from './detachedHistoryCheckpoint.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import {
  restoreDetachedHistory,
  type DetachedHistoryHost,
  type DetachedState,
} from './detachedHistoryMutation.js';

interface RollbackScope {
  active?: {
    readonly rows: DetachedHistoryJournal;
    readonly state: DetachedState;
    readonly host: DetachedHistoryHost;
  };
}

function scopedRestore(
  store: HistoryJournalStore,
  scope: RollbackScope,
  enqueue: (execute: () => Promise<void>) => Promise<void>,
): () => Promise<void> {
  return () =>
    enqueue(async () => {
      const captured = scope.active;
      if (captured === undefined)
        throw new Error('Detached rollback checkpoint is closed');
      await restoreDetachedHistory(
        store,
        captured.rows,
        captured.state,
        captured.host,
      );
    });
}

export async function withDetachedRollbackCheckpoint<T>(
  store: HistoryJournalStore,
  host: DetachedHistoryHost,
  enqueue: (execute: () => Promise<void>) => Promise<void>,
  execute: (restore: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const scope: RollbackScope = {};
  let state: DetachedState | undefined;
  try {
    return await withDetachedHistoryCheckpoint(
      store,
      host,
      (capture) =>
        enqueue(async () => {
          await capture();
          state = host.snapshot();
        }),
      async (rows) => {
        if (state === undefined)
          throw new Error('Rollback state was not captured');
        scope.active = { rows, state, host };
        return execute(scopedRestore(store, scope, enqueue));
      },
    );
  } finally {
    scope.active = undefined;
    state = undefined;
  }
}
