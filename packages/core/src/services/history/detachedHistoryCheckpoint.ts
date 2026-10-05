/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryJournalStore } from './historyJournalStore.js';
import type { HistoryIndexedRows } from './historyMutationSnapshot.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import { captureDetachedHistory } from './detachedHistoryCapture.js';
import { historyMutationFailure } from './historyMutationEffects.js';

export async function withDetachedHistoryCheckpoint<T>(
  journal: HistoryJournalStore,
  ownership: RowOwnership | undefined,
  enqueue: (execute: () => Promise<void>) => Promise<void>,
  settleTokens: () => Promise<void>,
  execute: (checkpoint: HistoryIndexedRows) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const checkpoint = new DetachedHistoryJournal(ownership);
  let outcome: { value: T } | { error: unknown };
  try {
    await enqueue(() =>
      captureDetachedHistory(
        journal,
        checkpoint,
        ownership,
        signal,
        settleTokens,
      ),
    );
    signal?.throwIfAborted();
    outcome = { value: await execute(checkpoint) };
  } catch (error) {
    outcome = { error };
  }
  const failures: unknown[] = [];
  try {
    checkpoint.close();
  } catch (error) {
    failures.push(error);
  }
  if ('error' in outcome) throw historyMutationFailure(outcome.error, failures);
  if (failures.length > 0)
    throw new AggregateError(failures, 'Detached checkpoint cleanup failed');
  return outcome.value;
}
