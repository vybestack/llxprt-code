/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { ChronologyRollbackEntry } from './historyBatchContracts.js';

export function trackMutationOwners(
  owners: Iterable<object>,
  ownership?: RowOwnership,
): () => void {
  if (ownership === undefined) return () => undefined;
  let acquired = 0;
  const release = (): void => {
    let remaining = acquired;
    acquired = 0;
    for (const owner of owners) {
      if (remaining === 0) break;
      ownership.release(owner);
      remaining--;
    }
  };
  try {
    for (const owner of owners) {
      ownership.retain(owner);
      acquired++;
    }
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

export function chronologyOwners(
  entries: Iterable<ChronologyRollbackEntry>,
): Iterable<object> {
  return {
    *[Symbol.iterator](): Generator<object, void, unknown> {
      for (const entry of entries) {
        yield entry.content;
        if (entry.chronology !== undefined) yield entry.chronology;
      }
    },
  };
}
