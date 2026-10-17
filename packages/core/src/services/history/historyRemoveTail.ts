/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  HistoryRemoveTailRequest,
  HistoryStorePort,
} from './historyStorePort.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import { isDeepStrictEqual } from 'node:util';
import type { IContent } from './IContent.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { PreparedHistoryBatchEffect } from './historyBatchContracts.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import { RemovalObserverFailure } from './historyRemovalObserverFailure.js';

function prefixOf(
  previous: HistoryMutationSnapshot,
  length: number,
): Iterable<IContent> & { readonly length: number } {
  return {
    length,
    *[Symbol.iterator](): Generator<IContent, void, unknown> {
      let index = 0;
      for (const row of previous) {
        if (index++ >= length) break;
        yield row;
      }
    },
  };
}

function cutIndex(
  previous: HistoryMutationSnapshot,
  removed: IContent,
): number {
  const seq = removed.metadata?.chronology?.seq;
  if (seq === undefined) return previous.length - 1;
  let index = 0;
  for (const row of previous) {
    if (row.metadata?.chronology?.seq === seq) return index;
    index++;
  }
  return previous.length - 1;
}

/**
 * The origin of each row from `cut` to the end, read before the rewind drops
 * them. Only the rows the rewind removes are listed: the origin is the one part
 * of a row the snapshot does not keep.
 */
function suffixOrigins(
  journal: HistoryStorePort,
  previous: HistoryMutationSnapshot,
  cut: number,
): Promise<ReadonlyArray<string | undefined>> {
  return journal.readRows(async (view) => {
    if (view.length !== previous.length)
      throw new Error('History changed between the snapshot and its removal');
    const origins: Array<string | undefined> = [];
    for (let index = cut; index < view.length; index++)
      origins.push(await view.originAt(index));
    return origins;
  });
}

function restoreSuffix(
  journal: HistoryStorePort,
  previous: HistoryMutationSnapshot,
  cut: number,
  origins: ReadonlyArray<string | undefined>,
): void {
  let index = 0;
  for (const content of previous) {
    if (index++ < cut) continue;
    const origin = origins[index - 1 - cut];
    journal.apply(
      origin === undefined
        ? { kind: 'content', content }
        : { kind: 'content', content, origin },
    );
  }
}

async function rollbackRemoval(
  journal: HistoryStorePort,
  previous: HistoryMutationSnapshot,
  cut: number,
  origins: ReadonlyArray<string | undefined>,
  admitted: boolean,
  effect: PreparedHistoryBatchEffect | undefined,
  primary: unknown,
  restored: (journalRestored: boolean) => void,
): Promise<never> {
  const failures: unknown[] = [];
  try {
    previous.restorePendingChronology();
  } catch (error) {
    failures.push(error);
  }
  let journalRestored = true;
  if (admitted) {
    try {
      restoreSuffix(journal, previous, cut, origins);
    } catch (error) {
      journalRestored = false;
      failures.push(error);
    }
  }
  restored(journalRestored);
  try {
    await effect?.rollback();
  } catch (error) {
    failures.push(error);
  }
  throw historyMutationFailure(primary, failures);
}

export type RemoveHistoryTailInput = HistoryRemoveTailRequest & {
  readonly journal: HistoryJournalStore;
};

export async function removeHistoryTail(
  input: RemoveHistoryTailInput,
): Promise<IContent | undefined> {
  return input.journal.withMutationSnapshot(async (previous) => {
    if (previous.length === 0) return undefined;
    const removed = previous.readRow(previous.length - 1);
    if (input.match !== undefined && !isDeepStrictEqual(removed, input.match))
      return undefined;
    input.ownership?.retain(removed);
    try {
      return await publishRemoval(input, previous, removed);
    } finally {
      input.ownership?.release(removed);
    }
  });
}

type RemovalInput = RemoveHistoryTailInput;

async function publishRemoval(
  input: RemovalInput,
  previous: HistoryMutationSnapshot,
  removed: IContent,
): Promise<IContent> {
  // A removal that is undone never reaches the mirrors, so the rows it put
  // back are not seen without the owners the removed rows had.
  const publication = input.journal.openPublication();
  let published = true;
  try {
    return await removeAndRecalculate(input, previous, removed, (restored) => {
      published = !restored;
    });
  } finally {
    publication.close(published);
  }
}

async function removeAndRecalculate(
  input: RemovalInput,
  previous: HistoryMutationSnapshot,
  removed: IContent,
  restored: (journalRestored: boolean) => void,
): Promise<IContent> {
  const cut = cutIndex(previous, removed);
  const effect = await input.owner?.prepareReplacement({
    previous,
    next: prefixOf(previous, cut),
    adopted: [],
    ownership: input.ownership,
  });
  let admitted = false;
  let origins: ReadonlyArray<string | undefined> = [];
  try {
    input.journal.adoptMutationBoundary(previous.durableTail);
    origins = await suffixOrigins(input.journal, previous, cut);
    input.journal.apply({
      kind: 'rewind',
      itemsRemoved: 1,
      cutSeq: removed.metadata?.chronology?.seq,
    });
    admitted = true;
    await effect?.publish();
  } catch (error) {
    return rollbackRemoval(
      input.journal,
      previous,
      cut,
      origins,
      admitted,
      effect,
      error,
      restored,
    );
  }
  try {
    await input.recalculate?.();
  } catch (error) {
    if (error instanceof RemovalObserverFailure) {
      return rollbackRemoval(
        input.journal,
        previous,
        cut,
        origins,
        true,
        effect,
        error.failure,
        restored,
      );
    }
    await effect?.finalize?.();
    throw error;
  }
  await effect?.finalize?.();
  return removed;
}
