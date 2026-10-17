/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { EntryFill, VersionEdit } from '../../journal/groupEdits.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import { FIRST_NEXT_LABEL } from '../../journal/labels.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import {
  checkedPositions,
  inheritingDraft,
  labelsAt,
  planDensity,
  publishClear,
  spansAfterClear,
  type PositionedContent,
  type PositionedOrigin,
  type PositionedOwner,
} from './journalHistoryEdits.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import type {
  HistoryClearRequest,
  HistoryJournalOp,
  HistoryMutationMark,
  HistoryPublicationScope,
  HistoryRemoveTailRequest,
  HistoryRepairRequest,
  HistoryResumeRequest,
} from './historyStorePort.js';
import type { ConversationStatistics } from './curationDebugLogger.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import type { HistoryRowView } from './historyRowView.js';
import {
  contextBoundaryOf,
  JournalRowView,
  lastContentOf,
  statisticsOf,
  type ContextBoundary,
} from './journalScalars.js';
import type { HistorySuffixQuery } from './historyJournalRows.js';
import {
  adoptOnto,
  type AdoptionHost,
  type JournalAdoption,
} from './journalAdoption.js';
import { JournalMirrors } from './journalMirrors.js';
import { JournalOwners, type ResolvedOwner } from './journalOwners.js';
import { suffixStart } from './journalSuffix.js';
import {
  decodeStoredRow,
  encodeContentRow,
  UNOWNED_ROW,
} from './journalRowCodec.js';
import {
  committedBatchSource,
  type CommittedBatchRowSource,
} from './journalBatchSource.js';
import {
  withCheckpointOnJournal,
  withRollbackCheckpointOnJournal,
} from './journalCheckpoints.js';
import { planToolPairingRepair } from './journalHistoryRepair.js';
import { publishDetachedOnJournal } from './journalPublishDetached.js';
import {
  reconcileMediaOnJournal,
  removeTailOnJournal,
} from './journalMediaMutations.js';
import type {
  DetachedHistoryHost,
  DetachedHistoryOptions,
  DetachedHistoryTask,
} from './detachedHistoryMutation.js';
import type { HistoryCheckpointRows } from './historyCheckpointRows.js';
import type { JournalSession } from './journalSession.js';
import {
  encodedRows,
  JournalPublication,
  originChangeEdits,
  ownerChangeEdits,
  syntheticInsertEdits,
  type EditBuilder,
  type JournalCompensationMark,
} from './journalPublication.js';
import type { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { adoptResumeOnJournal } from '../../recording/journalResumeAdoption.js';
import { previewOfContent } from '../../recording/sessionMetaKeys.js';
import { PendingRecorderWrites } from './pendingRecorderWrites.js';
import { SessionPreviews, recorderAcceptsRow } from './sessionPreviews.js';
import type { ResumePoint } from '../../recording/journalResume.js';
import type { DensityMutationPayload } from '../../recording/types.js';

/** The repair the journal store has published: `rollback` takes it back out, `close` has nothing to release. */
export interface JournalRepair {
  readonly inserted: IContent[];
  rollback(): Promise<void>;
  close(): void;
}

/**
 * The history of one session on a journal (design 4.1). Operations are
 * accepted synchronously and run one at a time in the order they arrive, each
 * as its own commit group on the version the previous one published. The row
 * count is the only state answered before an ack: it is the tentative count
 * of the queue, and every ack checks it against the version it published. No
 * row is held here: reads go to the file one row at a time.
 *
 * The first failure of the queue is kept. It rejects `waitForDurable` and
 * every later `apply` throws it, because later operations were planned on a
 * count that no longer holds.
 */
export class JournalHistoryStore {
  private tentativeRows: number;
  private queue: Promise<void> = Promise.resolve();
  private failure: { readonly error: unknown } | undefined;
  private ack: CommitAck | undefined;
  private disposed = false;
  private readonly publication = new JournalPublication();
  private owners: JournalOwners;
  private mirrorSet: JournalMirrors;
  private adopted: JournalRecordingService | undefined;
  private boundary: bigint | undefined;
  private previews = new SessionPreviews();
  private readonly adoptedWrites = new PendingRecorderWrites();

  constructor(private session: JournalSession) {
    this.tentativeRows = session.store.published?.rows ?? 0;
    this.owners = new JournalOwners(session.store);
    this.mirrorSet = this.mirrorsOf(session, this.owners);
  }

  /** The per-agent mirror files bound to this history. */
  get mirrors(): JournalMirrors {
    return this.mirrorSet;
  }

  private mirrorsOf(
    session: JournalSession,
    owners: JournalOwners,
    listeners?: Set<() => void>,
  ): JournalMirrors {
    return new JournalMirrors(
      session.store,
      owners,
      {
        exclusive: (task) => this.exclusive(task),
        assertUsable: () => this.assertUsable(),
      },
      listeners,
    );
  }

  /**
   * Resume onto a recorder (decision G5); see {@link adoptOnto}. The recorders
   * bound to this history move with it.
   */
  adoptJournal(
    recorder: JournalRecordingService,
    point: ResumePoint,
  ): Promise<JournalAdoption> {
    this.assertUsable();
    return this.exclusive(() =>
      adoptOnto(this.adoptionHost(), recorder, point),
    );
  }

  /** Resumes onto a journal recorder from the point its file was opened at; see {@link adoptResumeOnJournal}. */
  adoptResume(request: HistoryResumeRequest): Promise<string[]> {
    return adoptResumeOnJournal(this, request);
  }

  isAdoptingRecorder(recorder: JournalRecordingService): boolean {
    return this.adopted === recorder;
  }

  /** Rows with a label below this were written by an earlier process; every reader applies it (D-S08-3). */
  get resumeBoundary(): bigint | undefined {
    return this.boundary;
  }

  private adoptionHost(): AdoptionHost {
    return {
      state: () => ({
        session: this.session,
        owners: this.owners,
        mirrors: this.mirrorSet,
        rows: this.tentativeRows,
        adopted: this.adopted,
        previews: this.previews,
        resumeBoundary: this.boundary,
      }),
      install: (state) => {
        this.session = state.session;
        this.owners = state.owners;
        this.mirrorSet = state.mirrors;
        this.tentativeRows = state.rows;
        this.adopted = state.adopted;
        this.previews = state.previews;
        this.boundary = state.resumeBoundary;
      },
      drained: () => this.queue,
      mirrorsOf: (session, owners, listeners) =>
        this.mirrorsOf(session, owners, listeners),
    };
  }

  /** The ack of the last group that became durable. */
  get lastAck(): CommitAck | undefined {
    return this.ack;
  }

  journalPath(): string {
    return this.session.path;
  }

  /** Rows once everything queued is applied; equals the published count when the queue is empty. */
  getLength(): number {
    return this.tentativeRows;
  }

  apply(op: HistoryJournalOp): void {
    this.assertUsable();
    // Only rows an op writes carry its origin; a rewind, a density and a detail name who asked, not who owns.
    switch (op.kind) {
      case 'content':
        this.applyContent(op.content, op.tx, op.origin);
        return;
      case 'rewind':
        this.applyRewind(op.itemsRemoved);
        return;
      case 'compressed':
        this.applyCompressed(op.summary, op.origin);
        return;
      case 'syntheticInsert':
        this.applySyntheticInsert(
          op.payload.content,
          op.payload.afterSeq,
          op.origin,
        );
        return;
      case 'compressionDetail':
        // The span a compression destroyed is in the summary row's metadata (design 4.4).
        return;
      case 'density':
        this.applyDensity(op.payload);
        return;
      case 'replaceBegin':
      case 'replaceCommit':
      case 'replaceAbort':
        throw new Error(
          `The "${op.kind}" operation is not implemented in the journal store yet`,
        );
      default: {
        const unmapped: never = op;
        throw new Error(
          `Unmapped history operation ${JSON.stringify(unmapped)}`,
        );
      }
    }
  }

  /**
   * Rewrites the rows at `changes[].position` of the history under their own
   * labels and owners (a semantic media purge). Positions are those of the
   * history once everything queued is applied.
   */
  purge(changes: readonly PositionedContent[]): void {
    this.assertUsable();
    const sorted = checkedPositions(changes, this.tentativeRows);
    if (sorted.length === 0) return;
    const rows = sorted.map(({ content }) => inheritingDraft(content));
    const positions = sorted.map(({ position }) => position);
    this.enqueue(this.tentativeRows, async (snapshot) => {
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
    this.assertUsable();
    const sorted = checkedPositions(changes, this.tentativeRows);
    if (sorted.length > 0)
      this.enqueue(this.tentativeRows, ownerChangeEdits(sorted));
  }

  /** Like {@link changeOwners}, naming origins; `undefined` makes the row unowned. */
  changeOwnersOf(changes: readonly PositionedOrigin[]): void {
    this.assertUsable();
    const sorted = checkedPositions(changes, this.tentativeRows);
    if (sorted.length > 0)
      this.enqueue(this.tentativeRows, originChangeEdits(sorted, this.owners));
  }

  /** Sets entry fields of rows (design 8.2); the rows and their order do not change. */
  fill(fills: readonly EntryFill[]): void {
    this.assertUsable();
    if (fills.length === 0) return;
    this.enqueue(this.tentativeRows, () =>
      Promise.resolve([{ kind: 'fill', fills }]),
    );
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

  /**
   * The streamed `replace` group of {@link replaceStreamed} over rows that
   * are already encoded, so a caller can carry stored rows into the new
   * version without decoding them.
   */
  async replaceDrafts(
    rows: AsyncIterable<RowDraft>,
    signal?: AbortSignal,
    ownerEdits: readonly VersionEdit[] = [],
  ): Promise<CommitAck> {
    this.assertUsable();
    signal?.throwIfAborted();
    return this.requireAck(
      this.enqueueTurn(undefined, () =>
        Promise.resolve([...ownerEdits, { kind: 'replace', rows }]),
      ),
    );
  }

  /**
   * The owner id of `origin` for rows a caller encodes before their group
   * exists. The edits that register a new id must go in the group that
   * writes those rows (see {@link replaceDrafts}); when no such group is
   * written the caller calls {@link discardOwnerRegistration}.
   */
  resolveOwner(origin: string | undefined): Promise<ResolvedOwner> {
    return this.owners.resolve(origin);
  }

  /** Drops an owner id {@link resolveOwner} took that no group recorded. */
  discardOwnerRegistration(): void {
    this.owners.invalidate();
  }

  /**
   * The version a detached transform reads: the queue is durable, the token
   * updates the caller still owes are settled, and nothing was queued while
   * they ran. The snapshot holds a pin: the caller closes it.
   */
  async settledSnapshot(
    settleTokens: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<VersionSnapshot> {
    await this.waitForDurable();
    const snapshot = await this.session.store.snapshot();
    try {
      await settleTokens();
      await this.waitForDurable();
      this.assertSettled(snapshot, 'captured');
      signal?.throwIfAborted();
    } catch (error) {
      snapshot.close();
      throw error;
    }
    return snapshot;
  }

  /** Brackets one logical publication; the scope only counts (see {@link JournalPublication}). */
  openPublication(): HistoryPublicationScope {
    return this.publication.open();
  }

  /** Ordinals ordered rows of one publication for the token tickets, which this store does not have (G3). */
  withPublicationOrdinals(action: () => Promise<void>): Promise<void> {
    return action();
  }

  /**
   * The rows of the writer envelope that are not acked. The callers track the
   * owners of the operation they admit until its ack, and a queued group holds
   * encoded drafts only, so there is nothing further to retain.
   */
  capturePublicationOwners(): Iterable<IContent> {
    return [];
  }

  /** A version is the boundary of a mutation; there is no fold to adopt one into. */
  adoptMutationBoundary(): void {}

  mutationMark(): HistoryMutationMark {
    return this.publication.mark(this);
  }

  isCurrentMutationMark(mark: HistoryMutationMark): boolean {
    return this.publication.isCurrent(this, mark);
  }

  /**
   * Binds the file of `recorder` as the mirror of `origin`: it holds the
   * rows of that origin and the unowned ones, and every later group reaches
   * it (design 5.3).
   */
  attachJournal(
    recorder: JournalRecordingService,
    replace = false,
    onAttached?: () => void,
    origin?: string,
  ): Promise<void> {
    return this.mirrors
      .attachRecorder(recorder, replace, onAttached, origin)
      .then(async () => {
        const preview = this.previews.first((rowOrigin) =>
          recorderAcceptsRow(origin, rowOrigin),
        );
        if (preview === undefined) return;
        recorder.recordFirstUserPreview(preview);
        // The attach returns with the preview written, so no write of it is still in flight.
        await recorder.flush();
      });
  }

  detachJournal(recorder: JournalRecordingService): Promise<void> {
    return this.mirrors.detachRecorder(recorder);
  }

  isRecorder(recorder: JournalRecordingService): boolean {
    return this.mirrors.isRecorder(recorder);
  }

  /** Resolves when every mirror has applied the groups acked so far; throws every mirror failure. */
  async settleFanout(): Promise<void> {
    await this.queue;
    await this.mirrors.flush();
  }

  primaryOriginId(): string | undefined {
    return this.mirrors.primaryOriginId();
  }

  adoptedOrigin(origin: string | undefined): void {
    this.mirrors.adoptedOrigin(origin);
  }

  onRetired(listener: () => void): () => void {
    return this.mirrors.onRetired(listener);
  }

  /** Resolves when every operation applied so far is acked; throws the first failure of the queue. */
  async waitForDurable(): Promise<void> {
    await this.queue;
    await this.adoptedWrites.settle();
    if (this.failure !== undefined) throw this.failure.error;
  }

  /**
   * The rows of the history once the queue is durable, as of the version
   * published at the first read; later groups do not show in a stream that
   * has started.
   */
  async *streamRows(
    query?: HistorySuffixQuery,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    signal?.throwIfAborted();
    await this.waitForDurable();
    const snapshot = await this.session.store.snapshot();
    try {
      signal?.throwIfAborted();
      const start = await suffixStart(snapshot, query, signal, this.boundary);
      for await (const entry of snapshot.entries(start)) {
        signal?.throwIfAborted();
        yield decodeStoredRow(await snapshot.readRow(entry), this.boundary);
      }
      signal?.throwIfAborted();
    } finally {
      snapshot.close();
    }
  }

  /**
   * The last `count` rows (all rows when omitted) of the version published
   * now, as the source of a batch event. Call it once the publication it
   * announces is acked. The source holds a pin until its dispatcher retires it.
   */
  async committedBatch(count?: number): Promise<CommittedBatchRowSource> {
    const snapshot = await this.session.store.snapshot();
    try {
      return committedBatchSource(
        snapshot,
        count ?? snapshot.rows,
        this.boundary,
      );
    } catch (error) {
      snapshot.close();
      throw error;
    }
  }

  /**
   * The statistics of the last acked version, from its trailer; nothing is
   * read. Rows still queued are not counted (WIRING G2): a caller that needs
   * them waits for the queue first.
   */
  statistics(): ConversationStatistics {
    return statisticsOf(this.session.store.published?.aggregate);
  }

  /** The chronology boundary of the last acked version, from its trailer; see {@link statistics}. */
  contextBoundary(): ContextBoundary {
    return contextBoundaryOf(this.session.store.published?.aggregate);
  }

  /** The newest row, or the newest of `speaker`, once the queue is durable; nothing is kept. */
  lastContent(speaker?: IContent['speaker']): Promise<IContent | undefined> {
    return this.withDurableSnapshot((snapshot) =>
      lastContentOf(snapshot, speaker, this.boundary),
    );
  }

  /**
   * Row facts for a mutation, over the version durable now. The view reads the
   * file, so it holds no row, and it fails once `execute` has settled.
   */
  readRows<T>(
    execute: (view: HistoryRowView) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    return this.withDurableSnapshot(async (snapshot) => {
      const view = new JournalRowView(snapshot, this.owners, this.boundary);
      try {
        return await execute(view);
      } finally {
        view.close();
      }
    });
  }

  private async withDurableSnapshot<T>(
    read: (snapshot: VersionSnapshot) => Promise<T>,
  ): Promise<T> {
    await this.waitForDurable();
    const snapshot = await this.session.store.snapshot();
    try {
      return await read(snapshot);
    } finally {
      snapshot.close();
    }
  }

  /** Every row; for tests and tools that need the whole history, which a send never does. */
  async materialize(): Promise<IContent[]> {
    const rows: IContent[] = [];
    for await (const row of this.streamRows()) rows.push(row);
    return rows;
  }

  /** A dump of the rows once the queue is durable; it reads the file, so it holds no row. */
  async openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    await this.waitForDurable();
    return new JournalDumpSnapshot(
      await this.session.store.snapshot(),
      this.boundary,
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
  async clear(request: HistoryClearRequest): Promise<void> {
    await this.waitForDurable();
    const snapshot = await this.session.store.snapshot();
    try {
      await this.clearOver(snapshot, request);
    } finally {
      snapshot.close();
    }
  }

  private async clearOver(
    snapshot: VersionSnapshot,
    request: HistoryClearRequest,
  ): Promise<void> {
    this.assertSettled(snapshot, 'cleared');
    const spans = await spansAfterClear(snapshot, request.spans);
    if (snapshot.rows > 0) this.applyRewind(snapshot.rows);
    await publishClear(request, spans, () => this.restoreTo(snapshot));
  }

  /**
   * Inserts a synthetic response after every AI row whose tool calls have
   * none, and resolves once the insertions are durable. The rows come back
   * in `inserted`; they are small and few, one per unanswered call row.
   * `rollback` restores the version the repair started from, so it refuses
   * once any other group has been written.
   */
  async validateAndFix(request: HistoryRepairRequest): Promise<JournalRepair> {
    await this.waitForDurable();
    const snapshot = await this.session.store.snapshot();
    let plan: Awaited<ReturnType<typeof planToolPairingRepair>>;
    try {
      this.assertSettled(snapshot, 'repaired');
      plan = await planToolPairingRepair(
        this.session.store,
        snapshot,
        request.stamp,
      );
    } catch (error) {
      snapshot.close();
      throw error;
    }
    if (plan.inserts.length === 0 || snapshot.version === undefined) {
      snapshot.close();
      return {
        inserted: plan.inserted,
        rollback: async () => {},
        close: () => {},
      };
    }
    const rowsBefore = snapshot.rows;
    this.enqueue(rowsBefore + plan.inserts.length, () =>
      Promise.resolve(
        plan.inserts.map(({ afterLabel, draft }) => ({
          kind: 'insert' as const,
          afterLabel,
          draft,
        })),
      ),
    );
    await this.waitForDurable();
    const repairedAt = this.ack?.commitSeq;
    return {
      inserted: plan.inserted,
      rollback: async () => {
        if (this.ack?.commitSeq !== repairedAt) {
          throw new Error(
            'Rows were written since the repair; it cannot be rolled back',
          );
        }
        await this.restoreTo(snapshot);
      },
      close: () => snapshot.close(),
    };
  }

  /** Hands the owner every row, one at a time, once the queue is durable. */
  async adoptMediaOwner(
    owner: Pick<HistoryMediaOwner, 'adopt'>,
  ): Promise<void> {
    for await (const row of this.streamRows()) owner.adopt([row]);
  }

  /** Removes the newest row (design 4.3) and takes it back if the media effect or the observer fails. */
  removeTail(request: HistoryRemoveTailRequest): Promise<IContent | undefined> {
    return removeTailOnJournal(this, request);
  }

  /** Makes the owner hold the media of the current rows, one streamed pass. */
  reconcileMedia(owner: HistoryMediaOwner): Promise<void> {
    return reconcileMediaOnJournal(this, owner);
  }

  /**
   * Names the version the queue reaches with everything accepted so far, so a
   * later {@link compensate} can put it back without a copy of any row.
   */
  captureCompensation(): JournalCompensationMark {
    this.assertUsable();
    return {
      store: this,
      saved: this.queue.then(() => this.session.store.snapshot()),
    };
  }

  /** Lets go of the version a mark names; the owner of the mark calls it once, after the last compensation. */
  async releaseCompensation(mark: JournalCompensationMark): Promise<void> {
    (await mark.saved).close();
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
    mark: JournalCompensationMark,
    held: unknown,
  ): Promise<void> {
    if (mark.store !== this) {
      throw new Error('The compensation mark was not captured by this store');
    }
    const saved = await mark.saved;
    await this.queue;
    if (this.failure !== undefined) {
      if (this.failure.error !== held) throw this.failure.error;
      this.failure = undefined;
    }
    const unchanged =
      this.session.store.published?.commitSeq === saved.version?.commitSeq;
    if (unchanged) {
      this.tentativeRows = saved.rows;
      return;
    }
    await this.restoreTo(saved);
  }

  /** Runs a detached task against the durable rows and publishes its result (design 4.5). */
  publishDetached(
    task: DetachedHistoryTask,
    host: DetachedHistoryHost,
    modelName: string | undefined,
    options: DetachedHistoryOptions,
  ): Promise<void> {
    return publishDetachedOnJournal(this, task, host, modelName, options);
  }

  /** A checkpoint over the rows durable now (design 4.5): the callback reads them from the saved version. */
  withCheckpoint<T>(
    host: DetachedHistoryHost,
    enqueue: (execute: () => Promise<void>) => Promise<void>,
    execute: (checkpoint: HistoryCheckpointRows) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return withCheckpointOnJournal(this, host, enqueue, execute, signal);
  }

  /** A checkpoint whose `restore` is `restore(version)` of the version saved now. */
  withRollbackCheckpoint<T>(
    host: DetachedHistoryHost,
    enqueue: (execute: () => Promise<void>) => Promise<void>,
    execute: (restore: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    return withRollbackCheckpointOnJournal(this, host, enqueue, execute);
  }

  /** Settles the queue, then closes the journal. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.queue;
    try {
      await this.mirrors.retire();
    } finally {
      // An adopted file is the recorder's; the recorder closes it.
      if (this.adopted === undefined) await this.session.close();
    }
  }

  private applyContent(
    content: IContent,
    tx: string | undefined,
    origin: string | undefined,
  ): void {
    if (tx !== undefined) {
      throw new Error(
        'Rows of a replace transaction are not implemented in the journal store yet',
      );
    }
    // Encoded now: the chronology stamper writes the entry's metadata in place after the call.
    const draft = encodeContentRow(content, { owner: UNOWNED_ROW });
    this.offerPreview(content, origin);
    this.enqueue(this.tentativeRows + 1, async () => {
      const owner = await this.owners.resolve(origin);
      return [
        ...owner.edits,
        { kind: 'append', rows: [{ ...draft, owner: owner.id }] },
      ];
    });
  }

  /**
   * The first user row of an origin is the session preview of the recorders
   * that hold it (decision G7): the adopted file holds every row, a bound
   * recorder its own origin's and the unowned ones.
   */
  private offerPreview(content: IContent, origin: string | undefined): void {
    if (this.previews.has(origin)) return;
    const text = previewOfContent(content);
    if (text === undefined) return;
    this.previews.offer(origin, text);
    if (this.adopted !== undefined) {
      this.adopted.recordFirstUserPreview(text);
      this.adoptedWrites.track(this.adopted.flush());
    }
    this.mirrorSet.announcePreview(origin, text);
  }

  private applyDensity(payload: DensityMutationPayload): void {
    const planned = planDensity(payload);
    if (planned.empty) return;
    if (planned.removedRows > this.tentativeRows) {
      throw new Error(
        `A density removing ${planned.removedRows} rows exceeds the ${this.tentativeRows} rows of the history`,
      );
    }
    this.enqueue(this.tentativeRows - planned.removedRows, planned.build);
  }

  private applyRewind(itemsRemoved: number): void {
    if (
      !Number.isInteger(itemsRemoved) ||
      itemsRemoved < 0 ||
      itemsRemoved > this.tentativeRows
    ) {
      throw new Error(
        `A rewind of ${itemsRemoved} rows exceeds the ${this.tentativeRows} rows of the history`,
      );
    }
    if (itemsRemoved === 0) return;
    // The count is authoritative and the cut is the label of the row at that position (design 4.3).
    this.enqueue(this.tentativeRows - itemsRemoved, async (snapshot) => {
      const first = await snapshot.entryAt(snapshot.rows - itemsRemoved);
      return [
        { kind: 'pop', cutLabel: first.label, expectedRemoved: itemsRemoved },
      ];
    });
  }

  private applyCompressed(summary: IContent, origin: string | undefined): void {
    const draft = encodeContentRow(summary, { owner: UNOWNED_ROW });
    // A compression replaces the whole history; the rows to keep are appended after it.
    this.enqueue(1, async (snapshot) => {
      const owner = await this.owners.resolve(origin);
      return [
        ...owner.edits,
        {
          kind: 'compress',
          summary: { ...draft, owner: owner.id },
          retainFromLabel: snapshot.version?.nextLabel ?? FIRST_NEXT_LABEL,
          expectedReplaced: snapshot.rows,
        },
      ];
    });
  }

  private applySyntheticInsert(
    content: IContent,
    afterSeq: number,
    origin: string | undefined,
  ): void {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new Error(`Invalid synthetic insert anchor ${afterSeq}`);
    }
    const draft = encodeContentRow(content, { owner: UNOWNED_ROW });
    this.enqueue(
      this.tentativeRows + 1,
      syntheticInsertEdits(draft, afterSeq, origin, () => this.owners),
    );
  }

  /** Runs `task` after everything queued, ahead of anything queued later; its failure goes to the caller and does not stop the queue. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const turn = this.queue.then(() => {
      if (this.failure !== undefined) throw this.failure.error;
      return task();
    });
    this.queue = turn.then(
      () => undefined,
      () => undefined,
    );
    return turn;
  }

  /**
   * Queues one operation: the tentative count moves now, the group is built
   * and committed when the operations before it are acked, and its ack must
   * show the count that was promised.
   */
  private enqueue(rowsAfter: number, build: EditBuilder): void {
    void this.enqueueTurn(rowsAfter, build);
  }

  private enqueueTurn(
    rowsAfter: number | undefined,
    build: EditBuilder,
  ): Promise<CommitAck | undefined> {
    if (rowsAfter !== undefined) this.tentativeRows = rowsAfter;
    this.publication.accepted();
    const turn = this.queue.then(() => this.runStep(rowsAfter, build));
    this.queue = turn.then(() => undefined);
    return turn;
  }

  /** The ack of a queued group; a group the queue skipped or failed throws the failure that stopped it. */
  private async requireAck(
    turn: Promise<CommitAck | undefined>,
  ): Promise<CommitAck> {
    const ack = await turn;
    if (ack === undefined) {
      throw this.failure?.error ?? new Error('The group was not committed');
    }
    return ack;
  }

  /** The builder of the single `replace` edit of `rows`, every row written under `origin`. */
  private replaceEdits(
    rows: Iterable<IContent> | AsyncIterable<IContent>,
    origin: string | undefined,
  ): EditBuilder {
    return async () => {
      const owner = await this.owners.resolve(origin);
      return [
        ...owner.edits,
        { kind: 'replace', rows: encodedRows(rows, owner.id) },
      ];
    };
  }

  /** Puts the version of `saved` back as the current one (design 4.5) and waits for its ack. */
  private async restoreTo(saved: VersionSnapshot): Promise<void> {
    const version = saved.version;
    const edit: VersionEdit =
      version === undefined
        ? { kind: 'clear' }
        : { kind: 'restore', saved: version };
    await this.requireAck(
      this.enqueueTurn(saved.rows, () => Promise.resolve([edit])),
    );
  }

  private async runStep(
    rowsAfter: number | undefined,
    build: EditBuilder,
  ): Promise<CommitAck | undefined> {
    if (this.failure !== undefined) return undefined;
    try {
      return await this.commitStep(rowsAfter, build);
    } catch (error) {
      this.failure = { error };
      this.owners.invalidate();
      return undefined;
    }
  }

  /** The snapshot the builder reads stays pinned until the group is acked: the edits may stream from it. */
  private async commitStep(
    rowsAfter: number | undefined,
    build: EditBuilder,
  ): Promise<CommitAck> {
    const snapshot = await this.session.store.snapshot();
    try {
      const group = await this.mirrors.commit(await build(snapshot));
      try {
        if (rowsAfter === undefined) {
          this.tentativeRows = group.after.rows;
        } else if (group.after.rows !== rowsAfter) {
          throw new Error(
            `The journal holds ${group.after.rows} rows after commit ${group.ack.commitSeq}, the history promised ${rowsAfter}`,
          );
        }
        this.ack = group.ack;
        return group.ack;
      } finally {
        group.close();
      }
    } finally {
      snapshot.close();
    }
  }

  /** The mutation FIFO keeps the queue empty around a whole operation; a count that differs means it did not. */
  private assertSettled(snapshot: VersionSnapshot, doing: string): void {
    if (snapshot.rows !== this.tentativeRows) {
      throw new Error(`History changed while it was being ${doing}`);
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('The journal history store is disposed');
    if (this.failure !== undefined) throw this.failure.error;
  }
}
