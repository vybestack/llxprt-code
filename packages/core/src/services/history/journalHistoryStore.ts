/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { EntryFill, VersionEdit } from '../../journal/groupEdits.js';
import { INHERIT_OWNER } from '../../journal/groupEdits.js';
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
  type PositionedContent,
  type PositionedOrigin,
  type PositionedOwner,
} from './journalHistoryEdits.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import type {
  HistoryClearRequest,
  HistoryJournalOp,
  HistoryMutationMark,
  HistoryPublicationScope,
  HistoryRepairRequest,
} from './historyStorePort.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import type { HistorySuffixQuery } from './historyJournalRows.js';
import { JournalMirrors } from './journalMirrors.js';
import { JournalOwners, type ResolvedOwner } from './journalOwners.js';
import { suffixStart } from './journalSuffix.js';
import {
  decodeStoredRow,
  encodeContentRow,
  UNOWNED_ROW,
} from './journalRowCodec.js';
import { committedBatchSource } from './journalBatchSource.js';
import {
  withCheckpointOnJournal,
  withRollbackCheckpointOnJournal,
} from './journalCheckpoints.js';
import { planToolPairingRepair } from './journalHistoryRepair.js';
import { publishDetachedOnJournal } from './journalPublishDetached.js';
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
  type EditBuilder,
  type JournalCompensationMark,
} from './journalPublication.js';
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
  private readonly owners: JournalOwners;
  private readonly mirrors: JournalMirrors;

  constructor(private readonly session: JournalSession) {
    this.tentativeRows = session.store.published?.rows ?? 0;
    this.owners = new JournalOwners(session.store);
    this.mirrors = new JournalMirrors(session.store, this.owners);
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
   * they ran.
   */
  async settledSnapshot(
    settleTokens: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<VersionSnapshot> {
    await this.waitForDurable();
    const snapshot = this.session.store.snapshot();
    await settleTokens();
    await this.waitForDurable();
    this.assertSettled(snapshot, 'captured');
    signal?.throwIfAborted();
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

  /** Seeds and binds the mirror file of `origin` behind everything queued (late attach, design 5.3). */
  attachMirror(mirror: JournalSession, origin: string): Promise<void> {
    this.assertUsable();
    return this.exclusive(() => this.mirrors.attach(mirror, origin));
  }

  /** Unbinds a mirror once it has applied what was delivered; false when it was not bound. */
  detachMirror(mirror: JournalSession): Promise<boolean> {
    return this.exclusive(() => this.mirrors.detach(mirror));
  }

  isMirror(mirror: JournalSession): boolean {
    return this.mirrors.has(mirror);
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
    const snapshot = this.session.store.snapshot();
    signal?.throwIfAborted();
    const start = await suffixStart(snapshot, query, signal);
    for await (const entry of snapshot.entries(start)) {
      signal?.throwIfAborted();
      yield decodeStoredRow(await snapshot.readRow(entry));
    }
    signal?.throwIfAborted();
  }

  /**
   * The last `count` rows (all rows when omitted) of the version published
   * now, as the source of a batch event. Call it once the publication it
   * announces is acked.
   */
  committedBatch(count?: number): HistoryBatchRowSource {
    const snapshot = this.session.store.snapshot();
    return committedBatchSource(snapshot, count ?? snapshot.rows);
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
    return new JournalDumpSnapshot(this.session.store.snapshot());
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
    const snapshot = this.session.store.snapshot();
    this.assertSettled(snapshot, 'cleared');
    const spans = await this.spansAfterClear(snapshot, request.spans);
    if (snapshot.rows > 0) this.applyRewind(snapshot.rows);
    try {
      request.publish(spans);
    } catch (error) {
      if (!request.rollbackOnFailure) throw error;
      const failures: unknown[] = [];
      try {
        await this.restoreTo(snapshot);
      } catch (restoreError) {
        failures.push(restoreError);
      }
      request.restore();
      throw historyMutationFailure(error, failures);
    }
  }

  private async spansAfterClear(
    snapshot: VersionSnapshot,
    earlier: readonly RemovedInteriorSpan[],
  ): Promise<RemovedInteriorSpan[]> {
    if (snapshot.rows === 0) return mergeRemovedInteriorSpans(earlier);
    const start = Number((await snapshot.entryAt(0)).chronologySeq);
    const end = Number(
      (await snapshot.entryAt(snapshot.rows - 1)).chronologySeq,
    );
    return mergeRemovedInteriorSpans([
      ...earlier.filter((span) => span.start > end),
      { start, end, reason: 'cleared' },
    ]);
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
    const snapshot = this.session.store.snapshot();
    this.assertSettled(snapshot, 'repaired');
    const plan = await planToolPairingRepair(
      this.session.store,
      snapshot,
      request.stamp,
    );
    if (plan.inserts.length === 0 || snapshot.version === undefined) {
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
      close: () => {},
    };
  }

  /** Hands the owner every row, one at a time, once the queue is durable. */
  async adoptMediaOwner(
    owner: Pick<HistoryMediaOwner, 'adopt'>,
  ): Promise<void> {
    for await (const row of this.streamRows()) owner.adopt([row]);
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
      await this.session.close();
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
    this.enqueue(this.tentativeRows + 1, async () => {
      const owner = await this.owners.resolve(origin);
      return [
        ...owner.edits,
        { kind: 'append', rows: [{ ...draft, owner: owner.id }] },
      ];
    });
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
    this.enqueue(this.tentativeRows + 1, async (snapshot) => {
      const anchor = BigInt(afterSeq);
      for await (const entry of snapshot.entries()) {
        if (entry.chronologySeq === anchor) {
          // The op's owner, else the owner of the row it follows (design 5.1).
          const owner: {
            readonly id: number | typeof INHERIT_OWNER;
            readonly edits: ResolvedOwner['edits'];
          } =
            origin === undefined
              ? { id: INHERIT_OWNER, edits: [] }
              : await this.owners.resolve(origin);
          return [
            ...owner.edits,
            {
              kind: 'insert',
              afterLabel: entry.label,
              draft: { ...draft, owner: owner.id },
            },
          ];
        }
      }
      throw new Error(
        `Synthetic insert anchor: no row has chronology number ${afterSeq}`,
      );
    });
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
      const edits = await build(this.session.store.snapshot());
      const group = await this.mirrors.commit(edits);
      if (rowsAfter === undefined) {
        this.tentativeRows = group.after.rows;
      } else if (group.after.rows !== rowsAfter) {
        throw new Error(
          `The journal holds ${group.after.rows} rows after commit ${group.ack.commitSeq}, the history promised ${rowsAfter}`,
        );
      }
      this.ack = group.ack;
      return group.ack;
    } catch (error) {
      this.failure = { error };
      this.owners.invalidate();
      return undefined;
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
