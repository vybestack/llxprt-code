/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isDeepStrictEqual } from 'node:util';
import { collectMediaReferences } from '../../storage/media-reference-lifecycle.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { releaseRead } from '../../journal/pinLease.js';
import type { JournalStore } from '../../journal/journalStore.js';

export type NativeMediaOwner = Pick<
  HistoryMediaOwner,
  'adopt' | 'bindNativeMedia'
>;

export async function adoptOwner(
  store: JournalHistoryStore,
  journal: () => JournalStore,
  owner: NativeMediaOwner,
): Promise<void> {
  for await (const row of store.streamRows()) owner.adopt([row]);
  await owner.bindNativeMedia?.(journal());
}
import type {
  HistoryMediaOwner,
  PreparedHistoryBatchEffect,
} from './historyBatchContracts.js';
import {
  historyMutationFailure,
  rollbackMutationEffects,
} from './historyMutationEffects.js';
import { RemovalObserverFailure } from './historyRemovalObserverFailure.js';
import type { HistoryRemoveTailRequest } from './historyStorePort.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import {
  prepareMediaReplacement,
  snapshotReferences,
} from './journalMediaReferences.js';
import type { JournalCompensationMark } from './journalPublication.js';
import { lastContentOf } from './journalScalars.js';

/**
 * Removes the newest row with one `rewind` of one row. The row is read from
 * the version the removal starts from, which also is the version a failure
 * restores. Media is touched only when the removed row references some, and
 * then by one streamed pass over the rows that stay (decision G6).
 */
export async function removeTailOnJournal(
  store: JournalHistoryStore,
  request: HistoryRemoveTailRequest,
): Promise<IContent | undefined> {
  await store.waitForDurable();
  const mark = store.captureCompensation();
  try {
    const saved = await mark.saved;
    if (saved.rows !== store.getLength()) {
      throw new Error('History changed while its tail was being removed');
    }
    const tail = await lastContentOf(saved, undefined, store.resumeBoundary);
    if (tail === undefined) return undefined;
    if (request.match !== undefined && !isDeepStrictEqual(tail, request.match))
      return undefined;
    request.ownership?.retain(tail);
    try {
      await removeAndObserve(store, mark, saved, tail, request);
      return tail;
    } finally {
      request.ownership?.release(tail);
    }
  } finally {
    await store.releaseCompensation(mark);
  }
}

async function removeAndObserve(
  store: JournalHistoryStore,
  mark: JournalCompensationMark,
  saved: VersionSnapshot,
  tail: IContent,
  request: HistoryRemoveTailRequest,
): Promise<void> {
  const effect = await mediaEffectOfRemoval(saved, tail, request);
  try {
    store.apply({ kind: 'rewind', itemsRemoved: 1 });
    await store.waitForDurable();
    await effect?.publish();
  } catch (error) {
    throw await takeRemovalBack(store, mark, effect, error);
  }
  try {
    await request.recalculate?.();
  } catch (error) {
    if (error instanceof RemovalObserverFailure) {
      throw await takeRemovalBack(store, mark, effect, error.failure);
    }
    await effect?.finalize?.();
    throw error;
  }
  await effect?.finalize?.();
}

/** The owner's effect of the removal; none when the removed row holds no media. */
async function mediaEffectOfRemoval(
  saved: VersionSnapshot,
  tail: IContent,
  request: HistoryRemoveTailRequest,
): Promise<PreparedHistoryBatchEffect | undefined> {
  if (
    request.owner === undefined ||
    collectMediaReferences([tail]).length === 0
  )
    return undefined;
  return prepareMediaReplacement(
    request.owner,
    snapshotReferences(saved, saved.rows - 1),
    request.ownership,
  );
}

async function takeRemovalBack(
  store: JournalHistoryStore,
  mark: JournalCompensationMark,
  effect: PreparedHistoryBatchEffect | undefined,
  primary: unknown,
): Promise<unknown> {
  const failures: unknown[] = [];
  try {
    await store.compensate(mark, primary);
  } catch (error) {
    failures.push(error);
  }
  if (effect !== undefined)
    failures.push(...(await rollbackMutationEffects([effect])));
  return historyMutationFailure(primary, failures);
}

/**
 * Makes the owner hold exactly the media of the current rows: the references
 * are streamed into a replacement, published, and the owner swaps its
 * holdings. A failed publication is rolled back and rethrown.
 */
export async function reconcileMediaOnJournal(
  store: JournalHistoryStore,
  owner: HistoryMediaOwner,
): Promise<void> {
  await store.settleFanout();
  const effect = await prepareMediaReplacement(owner, currentReferences(store));
  try {
    await effect.publish();
  } catch (error) {
    throw historyMutationFailure(
      error,
      await rollbackMutationEffects([effect]),
    );
  }
  await effect.finalize?.();
}

async function* currentReferences(
  store: JournalHistoryStore,
): AsyncGenerator<MediaReferenceBlock, void, unknown> {
  const snapshot = await store.settledSnapshot(() => Promise.resolve());
  let failure: { readonly error: unknown } | undefined;
  try {
    yield* snapshotReferences(snapshot);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await releaseRead(snapshot, failure);
  }
}
