/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  HistoryJournalOp,
  HistoryJournalStore,
  HistoryMutationMark,
} from './historyJournalStore.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { trackMutationOwners } from './historyMutationOwnership.js';
import { journalPublicationOwners } from './historyPublicationOwners.js';

/**
 * What the live journal needs so that its rows equal the candidate's rows.
 * The cheapest shape that is exact wins, as in DetachedHistoryPublication.
 */
type ReplacementPlan =
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'rewind';
      readonly itemsRemoved: number;
      readonly cutSeq: number | undefined;
    }
  | { readonly kind: 'replace'; readonly txId: string; readonly rows: number };

async function nextOf<T>(iterator: AsyncIterator<T>): Promise<T | undefined> {
  const step = await iterator.next();
  return step.done === true ? undefined : step.value;
}

/**
 * Compare the live rows with the candidate rows without materializing either:
 * unchanged, a pure tail truncation (one rewind), or anything else.
 */
async function planReplacement(
  live: HistoryJournalStore,
  candidate: HistoryJournalStore,
): Promise<Exclude<ReplacementPlan, { kind: 'replace' }> | undefined> {
  const liveLength = live.getLength();
  const candidateLength = candidate.getLength();
  if (liveLength === 0 && candidateLength === 0) return { kind: 'unchanged' };
  if (candidateLength === 0)
    return { kind: 'rewind', itemsRemoved: liveLength, cutSeq: undefined };
  if (candidateLength > liveLength) return undefined;
  const liveRows = live.streamRows()[Symbol.asyncIterator]();
  const candidateRows = candidate.streamRows()[Symbol.asyncIterator]();
  try {
    for (let ordinal = 0; ordinal < candidateLength; ordinal++) {
      const [liveRow, candidateRow] = [
        await nextOf(liveRows),
        await nextOf(candidateRows),
      ];
      if (!isDeepStrictEqual(liveRow, candidateRow)) return undefined;
    }
    if (candidateLength === liveLength) return { kind: 'unchanged' };
    const firstRemoved = await nextOf(liveRows);
    const seq = firstRemoved?.metadata?.chronology?.seq;
    return {
      kind: 'rewind',
      itemsRemoved: liveLength - candidateLength,
      cutSeq: typeof seq === 'number' ? seq : undefined,
    };
  } finally {
    await Promise.all([liveRows.return?.(), candidateRows.return?.()]);
  }
}

/**
 * A candidate history staged against the live journal.
 *
 * Staging streams the candidate rows into the live journal as an open replace
 * transaction (`replace_begin` and tagged rows). Every reader folds an
 * unfinished transaction to the previous rows, so nothing is visible, and no
 * array of the context exists. Committing is one synchronous record
 * (`replace_commit`, or a single `rewind` when the candidate only drops the
 * tail), which flips the live rows atomically; durability follows through the
 * recorder's acknowledgements. Any other journal record between staging and
 * commit abandons the transaction, so a concurrent mutation is detected by the
 * journal mark and aborts the adoption instead of being merged.
 */
export class StagedProfileReplacement {
  private settled = false;

  private constructor(
    private readonly journal: HistoryJournalStore,
    private readonly ownership: RowOwnership | undefined,
    private readonly origin: string | undefined,
    private readonly plan: ReplacementPlan,
    private mark: HistoryMutationMark,
  ) {}

  static async stage(
    journal: HistoryJournalStore,
    candidate: HistoryJournalStore,
    ownership: RowOwnership | undefined,
    origin: string | undefined,
  ): Promise<StagedProfileReplacement> {
    const direct = await planReplacement(journal, candidate);
    if (direct !== undefined)
      return new StagedProfileReplacement(
        journal,
        ownership,
        origin,
        direct,
        journal.mutationMark(),
      );
    const open = { kind: 'replace' as const, txId: randomUUID(), rows: 0 };
    const staging = new StagedProfileReplacement(
      journal,
      ownership,
      origin,
      open,
      journal.mutationMark(),
    );
    await staging.writeTransaction(open, candidate);
    return staging;
  }

  private async writeTransaction(
    open: { txId: string; rows: number },
    candidate: HistoryJournalStore,
  ): Promise<void> {
    try {
      // An unmaterialized recorder buffers a non-content record until the
      // first content row, so the begin record has no acknowledgement to await.
      this.admit({ kind: 'replaceBegin', txId: open.txId })();
      for await (const content of candidate.streamRows()) {
        await this.record({ kind: 'content', content, tx: open.txId });
        open.rows++;
      }
    } catch (error) {
      throw await this.abortAfter(error, open);
    }
    this.mark = this.journal.mutationMark();
  }

  private async abortAfter(
    cause: unknown,
    open: { txId: string; rows: number },
  ): Promise<unknown> {
    try {
      await this.record({
        kind: 'replaceAbort',
        txId: open.txId,
        rowCount: open.rows,
      });
      return cause;
    } catch (abortFailure) {
      return new AggregateError(
        [cause, abortFailure],
        'Profile history staging failed and the open replacement was not aborted',
      );
    }
  }

  /** Admit one record and wait for its acknowledgement (bounded memory). */
  private async record(op: HistoryJournalOp): Promise<void> {
    const release = this.admit(op);
    try {
      await this.journal.waitForDurable();
    } finally {
      release();
    }
  }

  private admit(op: HistoryJournalOp): () => void {
    const release = trackMutationOwners(
      journalPublicationOwners(op),
      this.ownership,
    );
    try {
      this.journal.apply(
        this.origin === undefined ? op : { ...op, origin: this.origin },
      );
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  private assertUnsettled(): void {
    if (this.settled)
      throw new Error('Profile history adoption is already settled');
    this.settled = true;
  }

  /**
   * Flip the live rows synchronously. Throws, with the live history untouched,
   * when the journal changed after staging.
   */
  commit(): void {
    this.assertUnsettled();
    if (!this.journal.isCurrentMutationMark(this.mark))
      throw new Error(
        'Profile history adoption aborted: the live history changed after it was prepared',
      );
    const plan = this.plan;
    if (plan.kind === 'unchanged') return;
    const op: HistoryJournalOp =
      plan.kind === 'rewind'
        ? {
            kind: 'rewind',
            itemsRemoved: plan.itemsRemoved,
            ...(plan.cutSeq === undefined ? {} : { cutSeq: plan.cutSeq }),
          }
        : { kind: 'replaceCommit', txId: plan.txId, rowCount: plan.rows };
    const release = this.admit(op);
    void this.journal.waitForDurable().then(release, release);
  }

  /**
   * Discard the staged candidate. A transaction that no other record has
   * abandoned yet is closed with an abort record.
   */
  async rollback(): Promise<void> {
    this.assertUnsettled();
    const plan = this.plan;
    if (
      plan.kind !== 'replace' ||
      !this.journal.isCurrentMutationMark(this.mark)
    )
      return;
    await this.record({
      kind: 'replaceAbort',
      txId: plan.txId,
      rowCount: plan.rows,
    });
  }
}
