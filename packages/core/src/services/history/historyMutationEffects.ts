/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export function historyMutationFailure(
  primary: unknown,
  failures: readonly unknown[],
): unknown {
  return failures.length === 0
    ? primary
    : new AggregateError(
        [primary, ...failures],
        'History mutation and rollback failed',
      );
}

import type {
  PreparedHistoryBatchEffect,
  HistoryMediaOwner,
  HistoryOwnedMediaReservation,
} from './historyBatchContracts.js';
import type {
  HistoryMutationSnapshot,
  HistoryRowSource,
} from './historyMutationSnapshot.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

export async function rollbackMutationEffects(
  effects: readonly PreparedHistoryBatchEffect[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const effect of [...effects].reverse()) {
    try {
      await effect.rollback();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  return failures;
}

export async function prepareMutationEffects(
  owner: HistoryMediaOwner | undefined,
  effects: PreparedHistoryBatchEffect[],
  previous: HistoryMutationSnapshot,
  next: HistoryRowSource,
  adopted: readonly HistoryOwnedMediaReservation[],
  ownership?: RowOwnership,
): Promise<void> {
  if (owner !== undefined)
    effects.push(
      await owner.prepareReplacement({ previous, next, adopted, ownership }),
    );
}
