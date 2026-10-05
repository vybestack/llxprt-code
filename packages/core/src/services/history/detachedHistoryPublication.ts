/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type {
  HistoryJournalStore,
  HistoryJournalOp,
} from './historyJournalStore.js';
import { trackMutationOwners } from './historyMutationOwnership.js';
import { journalPublicationOwners } from './historyPublicationOwners.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';

export class DetachedHistoryPublication {
  admittedCount = 0;
  private releaseEnvelope = (): void => {};

  constructor(
    private readonly journal: HistoryJournalStore,
    private readonly ownership?: RowOwnership,
  ) {}

  async publish(
    previous: DetachedHistoryJournal,
    next: DetachedHistoryJournal,
    signal?: AbortSignal,
    appendOnly = false,
    awaitFinalCommit = true,
  ): Promise<void> {
    if (!appendOnly && previous.length > 0)
      await this.admit(
        { kind: 'rewind', itemsRemoved: previous.length },
        signal,
      );
    let index = 0;
    for (const content of next) {
      const ordinal = index++;
      if (!appendOnly || ordinal >= previous.length)
        await this.admit(
          { kind: 'content', content },
          signal,
          ordinal < next.length - 1 || awaitFinalCommit,
        );
    }
    signal?.throwIfAborted();
  }

  async compensate(
    previous: DetachedHistoryJournal,
    next: DetachedHistoryJournal,
    appendOnly = false,
  ): Promise<void> {
    if (appendOnly) {
      await this.admit({ kind: 'rewind', itemsRemoved: this.admittedCount });
      return;
    }
    await this.admit({
      kind: 'rewind',
      itemsRemoved: previous.length + next.length,
    });
    for (const content of previous)
      await this.admit({ kind: 'content', content });
  }

  private async admit(
    op: HistoryJournalOp,
    signal?: AbortSignal,
    awaitCommit = true,
  ): Promise<void> {
    signal?.throwIfAborted();
    let release = trackMutationOwners(
      journalPublicationOwners(op),
      this.ownership,
    );
    try {
      this.journal.apply(op);
      this.admittedCount++;
      const releaseEnvelope = trackMutationOwners(
        this.journal.capturePublicationOwners(),
        this.ownership,
      );
      this.releaseEnvelope();
      this.releaseEnvelope = releaseEnvelope;
      const acknowledgement = this.journal.waitForDurable();
      if (!awaitCommit) {
        const releaseAdmission = release;
        const releaseAcknowledged = (): void => {
          releaseEnvelope();
          releaseAdmission();
        };
        // The final admission can return before acknowledgement, but its owners cannot.
        this.releaseEnvelope = (): void => {};
        release = (): void => {};
        void acknowledgement.then(releaseAcknowledged, releaseAcknowledged);
        return;
      }
      await acknowledgement;
      this.close();
      signal?.throwIfAborted();
    } finally {
      release();
    }
  }

  close(): void {
    this.releaseEnvelope();
    this.releaseEnvelope = (): void => {};
  }
}
