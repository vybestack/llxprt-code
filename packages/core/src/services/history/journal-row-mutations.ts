/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { EntryFill, VersionEdit } from '../../journal/groupEdits.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import type { JournalStore } from '../../journal/journalStore.js';
import type { JournalOwners } from './journalOwners.js';
import type { JournalRepair } from './journal-history-store-types.js';
import type {
  HistoryClearRequest,
  HistoryRepairRequest,
} from './historyStorePort.js';
import type {
  EditBuilder,
  JournalCompensationMark,
} from './journalPublication.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import { applyOperation, type JournalWriteHost } from './journalOps.js';
import { planToolPairingRepair } from './journalHistoryRepair.js';
import {
  checkedPositions,
  inheritingDraft,
  labelsAt,
  publishClear,
  spansAfterClear,
  type PositionedContent,
  type PositionedOrigin,
  type PositionedOwner,
} from './journalHistoryEdits.js';
import { originChangeEdits, ownerChangeEdits } from './journalPublication.js';

interface JournalRowMutationHost {
  readonly writes: JournalWriteHost;
  assertUsable(): void;
  rows(): number;
  owners(): JournalOwners;
  store(): JournalStore;
  enqueue(rowsAfter: number, build: EditBuilder): void;
  withSnapshot<T>(read: (snapshot: VersionSnapshot) => Promise<T>): Promise<T>;
  assertSettled(snapshot: VersionSnapshot, doing: string): void;
  restoreTo(saved: VersionSnapshot): Promise<void>;
  waitForDurable(): Promise<void>;
  lastAck(): CommitAck | undefined;
  captureCompensation(): JournalCompensationMark;
  compensate(mark: JournalCompensationMark, held: unknown): Promise<void>;
  releaseCompensation(mark: JournalCompensationMark): Promise<void>;
}

export class JournalRowMutations {
  constructor(private readonly host: JournalRowMutationHost) {}

  /**
   * Rewrites the rows at `changes[].position` of the history under their own
   * labels and owners (a semantic media purge). Positions are those of the
   * history once everything queued is applied.
   */
  purge(changes: readonly PositionedContent[]): void {
    this.host.assertUsable();
    const sorted = checkedPositions(changes, this.host.rows());
    if (sorted.length === 0) return;
    const rows = sorted.map(({ content }) => inheritingDraft(content));
    const positions = sorted.map(({ position }) => position);
    this.host.enqueue(this.host.rows(), async (snapshot) => {
      const labels = await labelsAt(snapshot, positions);
      return [
        {
          kind: 'purge',
          rows: labels.map((label, at) => ({ label, draft: rows[at] })),
        },
      ];
    });
  }

  /** Gives the rows at `changes[].position` a new owner; no row is rewritten (design 5.4). */
  changeOwners(changes: readonly PositionedOwner[]): void {
    this.host.assertUsable();
    const sorted = checkedPositions(changes, this.host.rows());
    if (sorted.length > 0)
      this.host.enqueue(this.host.rows(), ownerChangeEdits(sorted));
  }

  /** Like {@link changeOwners}, naming origins; `undefined` makes the row unowned. */
  changeOwnersOf(changes: readonly PositionedOrigin[]): void {
    this.host.assertUsable();
    const sorted = checkedPositions(changes, this.host.rows());
    if (sorted.length > 0)
      this.host.enqueue(
        this.host.rows(),
        originChangeEdits(sorted, () => this.host.owners()),
      );
  }

  /** Sets entry fields of rows (design 8.2); the rows and their order do not change. */
  fill(fills: readonly EntryFill[]): void {
    this.host.assertUsable();
    if (fills.length === 0) return;
    this.host.enqueue(this.host.rows(), () =>
      Promise.resolve([{ kind: 'fill', fills }]),
    );
  }

  /**
   * Removes every row and publishes the spans the clear leaves behind. The
   * first and last chronology numbers come from the row headers of the
   * version the clear removes. It runs inside the service's mutation FIFO, so
   * no other operation is queued between the read and the rewind.
   *
   * A failing publish with rollback on puts the removed version back with
   * `restore(version)` (design 4.5) and then undoes the service's changes.
   */
  clear(request: HistoryClearRequest): Promise<void> {
    return this.host.withSnapshot(async (snapshot) => {
      this.host.assertSettled(snapshot, 'cleared');
      const spans = await spansAfterClear(snapshot, request.spans);
      if (snapshot.rows > 0) {
        const mark = this.host.captureCompensation();
        try {
          applyOperation(this.host.writes, {
            kind: 'rewind',
            itemsRemoved: snapshot.rows,
          });
          await this.host.waitForDurable();
        } catch (error) {
          const failures: unknown[] = [];
          try {
            await this.host.compensate(mark, error);
          } catch (failure) {
            failures.push(failure);
          }
          throw historyMutationFailure(error, failures);
        } finally {
          await this.host.releaseCompensation(mark);
        }
      }
      await publishClear(request, spans, () => this.host.restoreTo(snapshot));
    });
  }

  /**
   * Inserts a synthetic response after every AI row whose tool calls have
   * none, and resolves once the insertions are durable. The rows come back
   * in `inserted`; they are small and few, one per unanswered call row.
   * `rollback` restores the version the repair started from, so it refuses
   * once any other group has been written.
   */
  async validateAndFix(request: HistoryRepairRequest): Promise<JournalRepair> {
    await this.host.waitForDurable();
    const snapshot = await this.host.store().snapshot();
    let plan: Awaited<ReturnType<typeof planToolPairingRepair>>;
    try {
      this.host.assertSettled(snapshot, 'repaired');
      plan = await planToolPairingRepair(
        this.host.store(),
        snapshot,
        request.stamp,
      );
    } catch (error) {
      await snapshot.close();
      throw error;
    }
    if (plan.inserts.length === 0 || snapshot.version === undefined) {
      await snapshot.close();
      return {
        inserted: plan.inserted,
        rollback: async () => {},
        close: () => {},
      };
    }
    const rowsBefore = snapshot.rows;
    this.host.enqueue(rowsBefore + plan.inserts.length, () =>
      Promise.resolve(
        plan.inserts.map(
          ({ afterLabel, draft }): VersionEdit => ({
            kind: 'insert',
            afterLabel,
            draft,
          }),
        ),
      ),
    );
    await this.host.waitForDurable();
    const repairedAt = this.host.lastAck()?.commitSeq;
    return {
      inserted: plan.inserted,
      rollback: async () => {
        if (this.host.lastAck()?.commitSeq !== repairedAt) {
          throw new Error(
            'Rows were written since the repair; it cannot be rolled back',
          );
        }
        await this.host.restoreTo(snapshot);
      },
      close: () => snapshot.close(),
    };
  }
}
