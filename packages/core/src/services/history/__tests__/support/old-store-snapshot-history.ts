/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  HistoryService,
  type HistoryServiceJournalOptions,
} from '../../HistoryService.js';
import { HistoryJournalStore } from '../../historyJournalStore.js';
import type { HistoryMutationSnapshot } from '../../historyMutationSnapshot.js';

/**
 * A history whose old store's mutation snapshot can be taken directly. The
 * snapshot's capture, lifecycle and ownership are what the tests that use it
 * measure; no production caller of the service reaches the snapshot except
 * through the whole-operation port methods.
 */
export class SnapshotProbeHistory extends HistoryService {
  constructor(options: HistoryServiceJournalOptions = {}) {
    super({ ...options, backend: 'old' });
  }

  withSnapshot<T>(
    execute: (snapshot: HistoryMutationSnapshot) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!(this.journal instanceof HistoryJournalStore))
      throw new Error('The snapshot probe needs the old store');
    return this.journal.withMutationSnapshot(execute, signal);
  }
}
