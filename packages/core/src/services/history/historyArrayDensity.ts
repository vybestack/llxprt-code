/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';

export function restorePendingChronologyFailure(
  previous: HistoryMutationSnapshot,
  failures: unknown[],
): void {
  try {
    previous.restorePendingChronology();
  } catch (error) {
    failures.push(error);
  }
}
