/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  HistoryJournalStore,
  HistoryJournalOp,
} from './historyJournalStore.js';
import type { HistoryMutationInput } from './historyBatchContracts.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { planMutation } from './planHistoryMutation.js';
import { trackMutationOwners } from './historyMutationOwnership.js';
import { journalPublicationOwners } from './historyPublicationOwners.js';

export class HistoryMutationPublication {
  admittedCount = 0;
  private releaseOwners = (): void => {};
  private releaseEnvelopeOwners = (): void => {};

  constructor(
    private readonly journal: HistoryJournalStore,
    private readonly ownership?: RowOwnership,
  ) {}

  publish(
    previous: HistoryMutationSnapshot,
    input: HistoryMutationInput,
  ): void | Promise<void> {
    const streaming = input.streamPublication === true;
    if (streaming) this.journal.adoptMutationBoundary(previous.durableTail);
    const plan = planMutation(
      previous,
      input,
      streaming ? this.ownership : undefined,
    );
    if (streaming)
      return this.journal.withPublicationOrdinals(() =>
        this.publishStream(
          plan,
          input.signal,
          input.options.awaitDurableCommit === true,
        ),
      );
    for (const op of plan) this.admit(op);
  }

  private async publishStream(
    plan: Iterable<HistoryJournalOp>,
    signal: AbortSignal | undefined,
    awaitDurableCommit: boolean,
  ): Promise<void> {
    for (const op of plan) {
      await this.journal.waitForDurable();
      this.releaseOwners();
      signal?.throwIfAborted();
      this.releaseOwners = trackMutationOwners(
        journalPublicationOwners(op),
        this.ownership,
      );
      this.admit(op);
      const releaseNextEnvelope = trackMutationOwners(
        this.journal.capturePublicationOwners(),
        this.ownership,
      );
      this.releaseEnvelopeOwners();
      this.releaseEnvelopeOwners = releaseNextEnvelope;
    }
    if (awaitDurableCommit) await this.journal.waitForDurable();
  }

  private admit(op: HistoryJournalOp): void {
    this.journal.apply(op);
    this.admittedCount++;
  }

  close(): void {
    this.releaseEnvelopeOwners();
    this.releaseOwners();
  }
}
