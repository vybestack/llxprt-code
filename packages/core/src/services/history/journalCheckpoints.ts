/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { ContextRangeAccumulator } from './contextRange.js';
import type {
  DetachedHistoryHost,
  DetachedState,
} from './detachedHistoryMutation.js';
import type { HistoryCheckpointRows } from './historyCheckpointRows.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import { collectMediaReferences } from '../../storage/media-reference-lifecycle.js';
import {
  historyMutationFailure,
  rollbackMutationEffects,
} from './historyMutationEffects.js';
import { finalizeMutationEffects } from './historyMutationFailure.js';
import type { MediaReferenceBlock } from './IContent.js';
import { snapshotRows } from './journalDetachedCapture.js';

type Enqueue = (execute: () => Promise<void>) => Promise<void>;

/** The rows of `snapshot` as a checkpoint: the version is fixed, each pass reads it again. */
function snapshotCheckpoint(
  snapshot: VersionSnapshot,
  signal: AbortSignal | undefined,
): HistoryCheckpointRows {
  return {
    length: snapshot.rows,
    [Symbol.asyncIterator]: () => snapshotRows(snapshot, signal),
  };
}

/**
 * Settles the queue and the token updates inside the service queue, then runs
 * `execute` outside it (so it can publish) over the rows of the settled
 * version.
 */
export async function withCheckpointOnJournal<T>(
  store: JournalHistoryStore,
  host: DetachedHistoryHost,
  enqueue: Enqueue,
  execute: (checkpoint: HistoryCheckpointRows) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const captured: { snapshot?: VersionSnapshot } = {};
  await enqueue(async () => {
    captured.snapshot = await store.settledSnapshot(
      () => host.waitForTokenUpdates(),
      signal,
    );
  });
  signal?.throwIfAborted();
  if (captured.snapshot === undefined)
    throw new Error('The checkpoint was not captured');
  return execute(snapshotCheckpoint(captured.snapshot, signal));
}

/**
 * A checkpoint that can put the history back: the version, the token total,
 * the spans and the chronology counters as they were. Restoring is
 * `restore(version)` of the saved version, one group, and nothing when no
 * group was published since.
 */
export async function withRollbackCheckpointOnJournal<T>(
  store: JournalHistoryStore,
  host: DetachedHistoryHost,
  enqueue: Enqueue,
  execute: (restore: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const scope: { state?: DetachedState; mark?: JournalMark } = {};
  await enqueue(async () => {
    await store.settledSnapshot(() => host.waitForTokenUpdates());
    scope.mark = store.captureCompensation();
    scope.state = host.snapshot();
  });
  const restore = (): Promise<void> =>
    enqueue(async () => {
      const { mark, state } = scope;
      if (mark === undefined || state === undefined)
        throw new Error('Detached rollback checkpoint is closed');
      const before = host.snapshot();
      await restoreVersion(store, host, mark);
      const range = new ContextRangeAccumulator();
      for await (const row of store.streamRows()) range.add(row);
      host.chronology.restore(state.chronology);
      host.apply(state.tokens, state.spans);
      host.notify(state.tokens - before.tokens, range.snapshot(state.spans));
    });
  try {
    return await execute(restore);
  } finally {
    scope.mark = undefined;
    scope.state = undefined;
  }
}

/**
 * Puts the saved version back. With a media owner the references of the
 * saved rows are reserved first, streamed from the saved version, and the
 * owner swaps its holdings only once the version is back; if either step
 * fails the owner's effect is rolled back and the failure reported with any
 * rollback failure.
 */
async function restoreVersion(
  store: JournalHistoryStore,
  host: DetachedHistoryHost,
  mark: JournalMark,
): Promise<void> {
  const owner = host.mediaOwner;
  if (owner === undefined) {
    await store.compensate(mark, undefined);
    return;
  }
  const prepare = owner.prepareReferenceReplacement?.bind(owner);
  if (prepare === undefined) {
    throw new Error('History media owner does not support journal replacement');
  }
  const effect = await prepare(referencesOf(await mark.saved), host.ownership);
  try {
    await effect.publish();
    await store.compensate(mark, undefined);
  } catch (error) {
    throw historyMutationFailure(
      error,
      await rollbackMutationEffects([effect]),
    );
  }
  await finalizeMutationEffects([effect]);
}

async function* referencesOf(
  snapshot: VersionSnapshot,
): AsyncGenerator<MediaReferenceBlock, void, unknown> {
  for await (const row of snapshotRows(snapshot))
    yield* collectMediaReferences([row]);
}

type JournalMark = ReturnType<JournalHistoryStore['captureCompensation']>;
