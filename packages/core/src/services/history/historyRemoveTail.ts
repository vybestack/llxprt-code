/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isDeepStrictEqual } from 'node:util';
import type { IContent } from './IContent.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type {
  HistoryMediaOwner,
  PreparedHistoryBatchEffect,
} from './historyBatchContracts.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { historyMutationFailure } from './historyMutationEffects.js';

export class RemovalObserverFailure extends Error {
  constructor(readonly failure: unknown) {
    super('History removal observer failed', { cause: failure });
  }
}

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

function restoreSuffix(
  journal: HistoryJournalStore,
  previous: HistoryMutationSnapshot,
  cut: number,
): void {
  let index = 0;
  for (const content of previous) {
    if (index++ < cut) continue;
    journal.apply({ kind: 'content', content });
  }
}

async function rollbackRemoval(
  journal: HistoryJournalStore,
  previous: HistoryMutationSnapshot,
  cut: number,
  admitted: boolean,
  effect: PreparedHistoryBatchEffect | undefined,
  primary: unknown,
): Promise<never> {
  const failures: unknown[] = [];
  try {
    previous.restorePendingChronology();
  } catch (error) {
    failures.push(error);
  }
  if (admitted) {
    try {
      restoreSuffix(journal, previous, cut);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await effect?.rollback();
  } catch (error) {
    failures.push(error);
  }
  throw historyMutationFailure(primary, failures);
}

export async function removeHistoryTail(input: {
  readonly journal: HistoryJournalStore;
  readonly owner?: HistoryMediaOwner;
  readonly ownership?: RowOwnership;
  readonly match?: IContent;
  readonly recalculate?: () => Promise<void>;
}): Promise<IContent | undefined> {
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

type RemovalInput = Parameters<typeof removeHistoryTail>[0];

async function publishRemoval(
  input: RemovalInput,
  previous: HistoryMutationSnapshot,
  removed: IContent,
): Promise<IContent> {
  const cut = cutIndex(previous, removed);
  const effect = await input.owner?.prepareReplacement({
    previous,
    next: prefixOf(previous, cut),
    adopted: [],
    ownership: input.ownership,
  });
  let admitted = false;
  try {
    input.journal.adoptMutationBoundary(previous.durableTail);
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
      admitted,
      effect,
      error,
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
        true,
        effect,
        error.failure,
      );
    }
    await effect?.finalize?.();
    throw error;
  }
  await effect?.finalize?.();
  return removed;
}
