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
  type PositionedOwner,
} from './journalHistoryEdits.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
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
import {
  decodeStoredRow,
  encodeContentRow,
  UNOWNED_ROW,
} from './journalRowCodec.js';
import { captureDetachedRows } from './journalDetachedCapture.js';
import { planToolPairingRepair } from './journalHistoryRepair.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import type { JournalSession } from './journalSession.js';
import type { DensityMutationPayload } from '../../recording/types.js';

/** The repair the journal store has published: `rollback` takes it back out, `close` has nothing to release. */
export interface JournalRepair {
  readonly inserted: IContent[];
  rollback(): Promise<void>;
  close(): void;
}

/** Builds the edits of one queued operation against the version the previous operation published. */
type EditBuilder = (snapshot: VersionSnapshot) => Promise<VersionEdit[]>;

/**
 * The drafts of `rows`, each encoded when the writer asks for it. The stream
 * never checks a signal: a group that stops after its first byte poisons the
 * writer, so a cancellation is acted on before the group and after its ack.
 */
async function* encodedRows(
  rows: Iterable<IContent> | AsyncIterable<IContent>,
): AsyncGenerator<RowDraft> {
  for await (const content of rows) {
    yield encodeContentRow(content, { owner: UNOWNED_ROW });
  }
}

/** The builder of the single `replace` edit of `rows`. */
function replaceEdits(
  rows: Iterable<IContent> | AsyncIterable<IContent>,
): EditBuilder {
  return () => Promise.resolve([{ kind: 'replace', rows: encodedRows(rows) }]);
}

/** What a compensation puts back: the version the queue had reached when the mark was captured. */
export interface JournalCompensationMark {
  readonly store: JournalHistoryStore;
  readonly saved: Promise<VersionSnapshot>;
}

/** The first of the last `count` rows; a count that is not a positive number keeps the whole history. */
function recentStart(length: number, count: number): number {
  const start = -Math.trunc(count);
  if (Number.isNaN(start)) return 0;
  return start < 0 ? Math.max(length + start, 0) : Math.min(start, length);
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
  /** Groups accepted so far, acked or not; the mutation mark names this position. */
  private admitted = 0;
  private publicationDepth = 0;

  constructor(private readonly session: JournalSession) {
    this.tentativeRows = session.store.published?.rows ?? 0;
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
    if (op.origin !== undefined) {
      throw new Error(
        'Row owners are not implemented in the journal store yet',
      );
    }
    switch (op.kind) {
      case 'content':
        this.applyContent(op.content, op.tx);
        return;
      case 'rewind':
        this.applyRewind(op.itemsRemoved);
        return;
      case 'compressed':
        this.applyCompressed(op.summary);
        return;
      case 'syntheticInsert':
        this.applySyntheticInsert(op.payload.content, op.payload.afterSeq);
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
    if (sorted.length === 0) return;
    this.enqueue(this.tentativeRows, async (snapshot) => {
      const labels = await labelsAt(
        snapshot,
        sorted.map(({ position }) => position),
      );
      return [
        {
          kind: 'owner',
          changes: labels.map((label, at) => ({
            label,
            owner: sorted[at].owner,
          })),
        },
      ];
    });
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
   * caller's array out of the queued group.
   */
  replaceAll(rows: readonly IContent[]): void {
    this.assertUsable();
    const held = [...rows];
    this.enqueue(held.length, replaceEdits(held));
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
  ): Promise<CommitAck> {
    this.assertUsable();
    signal?.throwIfAborted();
    return this.requireAck(this.enqueueTurn(count, replaceEdits(rows)));
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
  ): Promise<CommitAck> {
    this.assertUsable();
    signal?.throwIfAborted();
    return this.requireAck(this.enqueueTurn(undefined, replaceEdits(rows)));
  }

  /** Brackets one logical publication. Fan-out holds are the work of S06; until then it only counts. */
  openPublication(): HistoryPublicationScope {
    this.publicationDepth++;
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        this.publicationDepth--;
      },
    };
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

  /** Names the position after the last group accepted; a later group makes the mark stale. */
  mutationMark(): HistoryMutationMark {
    return { binding: this, lastSeq: this.admitted };
  }

  isCurrentMutationMark(mark: HistoryMutationMark): boolean {
    return mark.binding === this && mark.lastSeq === this.admitted;
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
    const start = await this.suffixStart(snapshot, query, signal);
    for await (const entry of snapshot.entries(start)) {
      signal?.throwIfAborted();
      yield decodeStoredRow(await snapshot.readRow(entry));
    }
    signal?.throwIfAborted();
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

  /** Copies the durable rows into `previous`, the candidate-side journal the detached API still reads. */
  async captureDetached(
    previous: DetachedHistoryJournal,
    signal?: AbortSignal,
    settleTokens?: () => Promise<void>,
  ): Promise<void> {
    await this.waitForDurable();
    const snapshot = this.session.store.snapshot();
    await captureDetachedRows(snapshot, previous, signal);
    await settleTokens?.();
    await this.waitForDurable();
    this.assertSettled(snapshot, 'captured');
    signal?.throwIfAborted();
  }

  /** Settles the queue, then closes the journal. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.queue;
    await this.session.close();
  }

  private applyContent(content: IContent, tx: string | undefined): void {
    if (tx !== undefined) {
      throw new Error(
        'Rows of a replace transaction are not implemented in the journal store yet',
      );
    }
    // Encoded now: the chronology stamper writes the entry's metadata in place after the call.
    const draft = encodeContentRow(content, { owner: UNOWNED_ROW });
    this.enqueue(this.tentativeRows + 1, () =>
      Promise.resolve([{ kind: 'append', rows: [draft] }]),
    );
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

  private applyCompressed(summary: IContent): void {
    const draft = encodeContentRow(summary, { owner: UNOWNED_ROW });
    // A compression replaces the whole history; the rows to keep are appended after it.
    this.enqueue(1, (snapshot) =>
      Promise.resolve([
        {
          kind: 'compress',
          summary: draft,
          retainFromLabel: snapshot.version?.nextLabel ?? FIRST_NEXT_LABEL,
          expectedReplaced: snapshot.rows,
        },
      ]),
    );
  }

  private applySyntheticInsert(content: IContent, afterSeq: number): void {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new Error(`Invalid synthetic insert anchor ${afterSeq}`);
    }
    const draft = encodeContentRow(content, { owner: UNOWNED_ROW });
    this.enqueue(this.tentativeRows + 1, async (snapshot) => {
      const anchor = BigInt(afterSeq);
      for await (const entry of snapshot.entries()) {
        if (entry.chronologySeq === anchor) {
          return [
            {
              kind: 'insert',
              afterLabel: entry.label,
              draft: { ...draft, owner: INHERIT_OWNER },
            },
          ];
        }
      }
      throw new Error(
        `Synthetic insert anchor: no row has chronology number ${afterSeq}`,
      );
    });
  }

  private async suffixStart(
    snapshot: VersionSnapshot,
    query: HistorySuffixQuery | undefined,
    signal: AbortSignal | undefined,
  ): Promise<number> {
    if (query === undefined) return 0;
    if (query.kind === 'recent') return recentStart(snapshot.rows, query.count);
    return this.tokenSuffixStart(snapshot, query, signal);
  }

  private async tokenSuffixStart(
    snapshot: VersionSnapshot,
    query: Extract<HistorySuffixQuery, { kind: 'tokens' }>,
    signal: AbortSignal | undefined,
  ): Promise<number> {
    let start = snapshot.rows;
    let total = 0;
    while (start > 0) {
      signal?.throwIfAborted();
      const entry = await snapshot.entryAt(start - 1);
      const tokens = query.countTokens(
        decodeStoredRow(await snapshot.readRow(entry)),
      );
      if (!(total + tokens <= query.maxTokens)) break;
      total += tokens;
      start -= 1;
    }
    return start;
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
    this.admitted++;
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
      const group = await this.session.store.commitDetailed(edits);
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
