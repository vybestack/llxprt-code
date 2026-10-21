/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { PendingFoldSnapshot } from '../../recording/pendingFoldSnapshot.js';
import { executePinnedCursorAsync } from '../../recording/synchronousHistoryCursor.js';
import { withMergedHistoryRows } from './historyMergeRows.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import { rowViewOfCursor, type HistoryRowView } from './historyRowView.js';
import type { HistoryMergeRequest } from './historyStorePort.js';
import type {
  HistoryRowSummary,
  HistorySummaryTracker,
} from './historySummaryTracker.js';
import type { IContent } from './IContent.js';
import {
  findCurrentTurnMarker,
  type CurrentTurnMarker,
} from './historyChronology.js';

export async function oldStoreCurrentTurnMarker(this: {
  streamRows(): AsyncIterable<IContent>;
}): Promise<CurrentTurnMarker | null> {
  let latest: CurrentTurnMarker | null = null;
  for await (const row of this.streamRows()) {
    const marker = findCurrentTurnMarker([row]);
    if (marker !== null) latest = marker;
  }
  return latest;
}

export function materializeOldStore(store: {
  materializeSynchronously(): IContent[];
}): Promise<IContent[]> {
  return new Promise((resolve) => resolve(store.materializeSynchronously()));
}

/** What the old store's whole operations need of a store of its own kind. */
interface OldStoreSnapshots {
  withMutationSnapshot<T>(
    execute: (snapshot: HistoryMutationSnapshot) => Promise<T>,
  ): Promise<T>;
}

/** Runs `read` over the scalar summary of a fold snapshot and releases the snapshot afterwards. */
export function summarizeOldStore<T>(
  snapshot: PendingFoldSnapshot,
  tracker: HistorySummaryTracker,
  counters: JournalReadCounters | undefined,
  read: (summary: HistoryRowSummary) => T,
): T {
  try {
    return read(tracker.summarize(snapshot, counters));
  } finally {
    snapshot.release();
  }
}

/** Hands `execute` the row view of a fold snapshot and releases the snapshot when it settles. */
export async function readOldStoreRows<T>(
  snapshot: PendingFoldSnapshot,
  counters: JournalReadCounters | undefined,
  execute: (view: HistoryRowView) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await executePinnedCursorAsync(
      snapshot,
      (cursor) => execute(rowViewOfCursor(cursor)),
      counters,
      signal,
    );
  } finally {
    snapshot.release();
  }
}

function hasMutationSnapshots(source: object): source is OldStoreSnapshots {
  return (
    'withMutationSnapshot' in source &&
    typeof source.withMutationSnapshot === 'function'
  );
}

/** The old store's merge: both sides are snapshotted, so `request.source` must be an old store too. */
export function mergeOldStores(
  target: OldStoreSnapshots,
  request: HistoryMergeRequest,
): Promise<void> {
  const source = request.source;
  if (!hasMutationSnapshots(source))
    return Promise.reject(
      new Error(
        'History backend mismatch: the old store merges only from the old store',
      ),
    );
  return target.withMutationSnapshot((previous) =>
    source.withMutationSnapshot((incoming) =>
      withMergedHistoryRows(
        previous,
        incoming,
        (candidate) => request.publish(candidate, previous),
        request.ownership,
      ),
    ),
  );
}

export async function adoptOldStoreMedia(
  this: Pick<HistoryJournalStore, 'withReadRows'>,
  owner: Pick<HistoryMediaOwner, 'adopt'>,
): Promise<void> {
  const adopt = this.withReadRows((cursor) => owner.adopt(cursor.rows()));
  return Promise.resolve(adopt);
}
