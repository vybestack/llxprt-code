/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { planReplacement } from './historyProfileReplacement.js';
import type {
  HistoryMutationMark,
  HistoryProfileReplacementRequest,
  ProfileCandidateRows,
  StagedProfileAdoption,
} from './historyStorePort.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import type { JournalCompensationMark } from './journalPublication.js';

/**
 * A profile replacement written into the live journal (decision G3). The
 * group is atomic and visible at its ack, so the live rows change while
 * staging; `commit` only checks that nothing was written since, and
 * `rollback` is `restore(version)` of the version saved before the group.
 */
class StagedJournalReplacement implements StagedProfileAdoption {
  private settled = false;

  constructor(
    private readonly store: JournalHistoryStore,
    private readonly saved: JournalCompensationMark,
    private readonly mark: HistoryMutationMark,
  ) {}

  commit(): void {
    if (this.settled)
      throw new Error('Profile history adoption is already settled');
    if (!this.store.isCurrentMutationMark(this.mark))
      throw new Error(
        'Profile history adoption aborted: the live history changed after it was prepared',
      );
    this.settled = true;
    void this.store.releaseCompensation(this.saved);
  }

  async rollback(): Promise<void> {
    if (this.settled)
      throw new Error('Profile history adoption is already settled');
    this.settled = true;
    try {
      if (!this.store.isCurrentMutationMark(this.mark))
        throw new Error(
          'Profile history adoption cannot be rolled back: the live history changed after it was prepared',
        );
      await this.store.compensate(this.saved, undefined);
    } finally {
      await this.store.releaseCompensation(this.saved);
    }
  }
}

/** Writes the cheapest group that makes the live rows equal `candidate`: nothing, one rewind, or one streamed replace. */
async function writeReplacement(
  store: JournalHistoryStore,
  candidate: ProfileCandidateRows,
  origin: string | undefined,
): Promise<void> {
  const plan = await planReplacement(store, candidate);
  if (plan?.kind === 'unchanged') return;
  if (plan?.kind === 'rewind') {
    store.apply({ kind: 'rewind', itemsRemoved: plan.itemsRemoved });
    await store.waitForDurable();
    return;
  }
  await store.replaceStreamed(candidate.streamRows(), undefined, origin);
}

/** Puts the previous version back after a failed staging; the error to throw joins the failures of the take-back. */
async function takeBack(
  store: JournalHistoryStore,
  saved: JournalCompensationMark,
  cause: unknown,
): Promise<unknown> {
  const failures: unknown[] = [cause];
  try {
    await store.compensate(saved, cause);
  } catch (failure) {
    failures.push(failure);
  }
  try {
    await store.releaseCompensation(saved);
  } catch (failure) {
    failures.push(failure);
  }
  return failures.length === 1
    ? cause
    : new AggregateError(
        failures,
        'Profile history staging failed and the previous rows were not restored',
      );
}

export async function stageProfileReplacementOnJournal(
  store: JournalHistoryStore,
  candidate: ProfileCandidateRows,
  request: HistoryProfileReplacementRequest,
): Promise<StagedProfileAdoption> {
  await store.waitForDurable();
  const saved = store.captureCompensation();
  try {
    await writeReplacement(store, candidate, request.origin);
  } catch (error) {
    throw await takeBack(store, saved, error);
  }
  return new StagedJournalReplacement(store, saved, store.mutationMark());
}
