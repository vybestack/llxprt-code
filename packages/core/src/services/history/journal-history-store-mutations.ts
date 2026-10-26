/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryCheckpointRows } from './historyCheckpointRows.js';
import { JournalHistoryStoreReads } from './journal-history-store-reads.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import type { JournalSession } from './journalSession.js';
import type { JournalOwners, ResolvedOwner } from './journalOwners.js';
import type { JournalRowMutations } from './journal-row-mutations.js';
import type { IContent } from './IContent.js';
import type {
  PositionedContent,
  PositionedOwner,
  PositionedOrigin,
} from './journalHistoryEdits.js';
import type { EntryFill, VersionEdit } from '../../journal/groupEdits.js';
import type { GroupPreparation } from '../../journal/preparedGroup.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import type { MirrorCheckpoint } from '../../journal/mirrorCheckpoint.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type {
  HistoryClearRequest,
  HistoryRepairRequest,
  HistoryRemoveTailRequest,
  HistoryMergeRequest,
  HistoryDensityRequest,
  ProfileCandidateRows,
  HistoryProfileReplacementRequest,
  StagedProfileAdoption,
  HistoryCompensationMark,
} from './historyStorePort.js';
import type {
  DetachedHistoryHost,
  DetachedHistoryTask,
  DetachedHistoryOptions,
} from './detachedHistoryMutation.js';
import {
  type JournalPublication,
  JournalCompensationMark,
  preparedDetachedEdit,
  type replacementEditBuilder,
  type EditBuilder,
} from './journalPublication.js';
import type * as StoreTypes from './journal-history-store-types.js';
import type { SemanticPurgeSnapshot } from './semantic-purge-native.js';
import { openJournalSemanticPurge } from './journalSemanticPurge.js';
import * as mediaMutations from './journalMediaMutations.js';
import { mergeOnJournal } from './journalMerge.js';
import { optimizeDensityOnJournal } from './journalDensity.js';
import { stageProfileReplacementOnJournal } from './journalProfileReplacement.js';
import { publishDetachedOnJournal } from './journalPublishDetached.js';
import {
  journalCheckpointReader,
  withRollbackCheckpointOnJournal,
} from './journalCheckpoints.js';

export abstract class JournalHistoryStoreMutations extends JournalHistoryStoreReads {
  protected abstract get operationStore(): JournalHistoryStore;
  protected abstract get session(): JournalSession;
  protected abstract get owners(): JournalOwners;
  protected abstract readonly publication: JournalPublication;
  protected abstract readonly rowMutations: JournalRowMutations;
  protected abstract queue: Promise<void>;
  protected abstract failure:
    | { readonly error: unknown; reported?: boolean }
    | undefined;
  protected abstract tentativeRows: number;
  protected abstract exclusive<T>(
    task: () => Promise<T>,
    detaching?: boolean,
  ): Promise<T>;
  protected abstract enqueue(rowsAfter: number, build: EditBuilder): void;
  protected abstract enqueueTurn(
    rowsAfter: number | undefined,
    build: EditBuilder,
    mirrors?: MirrorCheckpoint,
  ): Promise<CommitAck | undefined>;
  protected abstract requireAck(
    turn: Promise<CommitAck | undefined>,
  ): Promise<CommitAck>;
  protected abstract restoreTo(
    saved: VersionSnapshot,
    mirrors?: MirrorCheckpoint,
  ): Promise<void>;
  protected abstract readonly replaceEdits: ReturnType<
    typeof replacementEditBuilder
  >;
  purge(changes: readonly PositionedContent[]): void {
    this.rowMutations.purge(changes);
  }

  changeOwners(changes: readonly PositionedOwner[]): void {
    this.rowMutations.changeOwners(changes);
  }

  changeOwnersOf(changes: readonly PositionedOrigin[]): void {
    this.rowMutations.changeOwnersOf(changes);
  }

  fill(fills: readonly EntryFill[]): void {
    this.rowMutations.fill(fills);
  }

  /**
   * Replaces the whole history by `rows` in one group. The rows are encoded
   * as the writer pulls them, one at a time, so no encoded copy of the array
   * exists. Only the references are copied, which keeps a later edit of the
   * caller's array out of the queued group. Every row is written under
   * `origin`, unowned when it is omitted.
   */
  replaceAll(rows: readonly IContent[], origin?: string): void {
    this.assertUsable();
    const held = [...rows];
    this.enqueue(held.length, this.replaceEdits(held, origin));
  }

  /**
   * Replaces the history by the `count` rows `rows` yields, as one group
   * whose rows are pulled by the writer one at a time (design 4.5). It
   * resolves with the ack of the group's trailer and not before: that is the
   * only point at which the replacement is durable. A cancellation is honoured
   * before the group starts; once rows are being written the group runs to its
   * trailer, and the caller compensates after the ack if it still must undo it.
   */
  async replaceFrom(
    rows: Iterable<IContent> | AsyncIterable<IContent>,
    count: number,
    signal?: AbortSignal,
    origin?: string,
  ): Promise<CommitAck> {
    this.assertUsable();
    signal?.throwIfAborted();
    return this.requireAck(
      this.enqueueTurn(count, this.replaceEdits(rows, origin)),
    );
  }

  /**
   * Like {@link replaceFrom}, for a source whose row count is known only when
   * it ends (a transform streaming its output). The tentative count is not
   * moved when the group is queued; the ack's count becomes the length. The
   * caller must hold the store quiet around it, as the mutation FIFO does.
   */
  async replaceStreamed(
    rows: AsyncIterable<IContent>,
    signal?: AbortSignal,
    origin?: string,
  ): Promise<CommitAck> {
    this.assertUsable();
    signal?.throwIfAborted();
    return this.requireAck(
      this.enqueueTurn(undefined, this.replaceEdits(rows, origin)),
    );
  }

  async prepareDetached(
    prepare: GroupPreparation,
    ownerEdits: readonly VersionEdit[],
  ): Promise<CommitAck> {
    this.assertUsable();
    return this.requireAck(
      this.enqueueTurn(undefined, () =>
        Promise.resolve([preparedDetachedEdit(prepare, ownerEdits)]),
      ),
    );
  }

  /**
   * The owner id of `origin` for rows a caller encodes before their group
   * exists. The edits that register a new id must go in the group that
   * writes those rows (see {@link prepareDetached}); when no such group is
   * written the caller calls {@link discardOwnerRegistration}.
   */
  resolveOwner(origin: string | undefined): Promise<ResolvedOwner> {
    return this.owners.resolve(origin);
  }

  /** Drops an owner id {@link resolveOwner} took that no group recorded. */
  discardOwnerRegistration(): void {
    this.owners.invalidate();
  }

  openSemanticPurgeSnapshot(
    host: DetachedHistoryHost,
  ): Promise<SemanticPurgeSnapshot> {
    return openJournalSemanticPurge(this.operationStore, host);
  }

  clear(request: HistoryClearRequest): Promise<void> {
    return this.rowMutations.clear(request);
  }

  validateAndFix(
    request: HistoryRepairRequest,
  ): Promise<StoreTypes.JournalRepair> {
    return this.rowMutations.validateAndFix(request);
  }

  /** Hands the owner every row, one at a time, once the queue is durable. */
  adoptMediaOwner(owner: mediaMutations.NativeMediaOwner): Promise<void> {
    return mediaMutations.adoptOwner(
      this.operationStore,
      () => this.session.store,
      owner,
    );
  }

  /** Removes the newest row (design 4.3) and takes it back if the media effect or the observer fails. */
  removeTail(request: HistoryRemoveTailRequest): Promise<IContent | undefined> {
    return mediaMutations.removeTailOnJournal(this.operationStore, request);
  }

  /** Makes the owner hold the media of the current rows, one streamed pass. */
  reconcileMedia(owner: HistoryMediaOwner): Promise<void> {
    return mediaMutations.reconcileMediaOnJournal(this.operationStore, owner);
  }

  /** Appends the accepted rows of another history as one detached append. */
  mergeFrom(request: HistoryMergeRequest): Promise<void> {
    return mergeOnJournal(this.operationStore, request);
  }

  /** Applies the decisions of a density optimizer as one detached transform. */
  optimizeDensity(request: HistoryDensityRequest): Promise<void> {
    return optimizeDensityOnJournal(this.operationStore, request);
  }

  /** Writes `candidate` as the live rows at once; `rollback` restores the saved version (decision G3). */
  stageProfileReplacement(
    candidate: ProfileCandidateRows,
    request: HistoryProfileReplacementRequest,
  ): Promise<StagedProfileAdoption> {
    return stageProfileReplacementOnJournal(
      this.operationStore,
      candidate,
      request,
    );
  }

  /**
   * Names the version the queue reaches with everything accepted so far, so a
   * later {@link compensate} can put it back without a copy of any row.
   */
  captureCompensation(): JournalCompensationMark {
    this.assertUsable();
    return this.publication.capture(
      this.operationStore,
      this.exclusive(async () => {
        const snapshot = await this.session.store.snapshot();
        try {
          return { snapshot, mirrors: await this.mirrors.checkpoint() };
        } catch (error) {
          await snapshot.close();
          throw error;
        }
      }),
    );
  }

  /** Lets go of the version a mark names; the owner of the mark calls it once, after the last compensation. */
  async releaseCompensation(mark: JournalCompensationMark): Promise<void> {
    await this.publication.release(mark);
  }

  /**
   * Undoes everything admitted since `mark` with `restore(version)`. When no
   * group was acked since, nothing is written. `held` is the failure the
   * caller received from its own groups, or undefined when it received none
   * from the store. Only that failure is cleared: a failure the queue holds
   * that the caller does not hold was never reported to anyone, so it stays
   * sticky and is thrown from here instead of being lost. If the restore
   * itself fails the store keeps that failure.
   */
  async compensate(
    mark: HistoryCompensationMark,
    held: unknown,
  ): Promise<void> {
    if (
      !(mark instanceof JournalCompensationMark) ||
      mark.store !== this.operationStore
    ) {
      throw new Error('The compensation mark was not captured by this store');
    }
    const captured = await mark.captured;
    const saved = captured.snapshot;
    await this.queue;
    if (this.failure !== undefined) {
      if (this.failure.error !== held) throw this.failure.error;
      this.failure = undefined;
    }
    const unchanged =
      this.session.store.published?.commitSeq === saved.version?.commitSeq;
    if (unchanged) {
      this.tentativeRows = saved.rows;
    } else {
      await this.restoreTo(saved, captured.mirrors);
    }
    this.publication.compensated(mark);
  }

  /** Runs a detached task against the durable rows and publishes its result (design 4.5). */
  publishDetached(
    task: DetachedHistoryTask,
    host: DetachedHistoryHost,
    modelName: string | undefined,
    options: DetachedHistoryOptions,
  ): Promise<void> {
    return publishDetachedOnJournal(
      this.operationStore,
      task,
      host,
      modelName,
      options,
    );
  }

  /** A checkpoint over the rows durable now (design 4.5): the callback reads them from the saved version. */
  withCheckpoint<T>(
    host: DetachedHistoryHost,
    enqueue: (execute: () => Promise<void>) => Promise<void>,
    execute: (checkpoint: HistoryCheckpointRows) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return journalCheckpointReader(
      this.operationStore,
      () => this.options.counters,
    )(host, enqueue, execute, signal);
  }

  /** A checkpoint whose `restore` is `restore(version)` of the version saved now. */
  withRollbackCheckpoint<T>(
    host: DetachedHistoryHost,
    enqueue: (execute: () => Promise<void>) => Promise<void>,
    execute: (restore: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return withRollbackCheckpointOnJournal(
      this.operationStore,
      host,
      enqueue,
      execute,
    );
  }
}
