/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from '../../journal/groupEdits.js';
import { INHERIT_OWNER } from '../../journal/groupEdits.js';
import type { CommitAck } from '../../journal/groupWriter.js';
import { FIRST_NEXT_LABEL } from '../../journal/labels.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import type {
  HistoryClearRequest,
  HistoryJournalOp,
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
import type { JournalSession } from './journalSession.js';

/** Builds the edits of one queued operation against the version the previous operation published. */
type EditBuilder = (snapshot: VersionSnapshot) => Promise<VersionEdit[]>;

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
      case 'replaceBegin':
      case 'replaceCommit':
      case 'replaceAbort':
      case 'density':
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
   * A rollback needs the removed version back, which is `restore(version)`
   * (S05); until then a failing publish with rollback on says so.
   */
  async clear(request: HistoryClearRequest): Promise<void> {
    await this.waitForDurable();
    const snapshot = this.session.store.snapshot();
    if (snapshot.rows !== this.tentativeRows) {
      throw new Error('History changed while it was being cleared');
    }
    const spans = await this.spansAfterClear(snapshot, request.spans);
    if (snapshot.rows > 0) this.applyRewind(snapshot.rows);
    try {
      request.publish(spans);
    } catch (error) {
      if (!request.rollbackOnFailure) throw error;
      request.restore();
      throw historyMutationFailure(error, [
        new Error('not implemented: S05 (restore the rows of a failed clear)'),
      ]);
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

  validateAndFix(): never {
    throw new Error('not implemented: S04 (tool-pairing repair)');
  }

  adoptMediaOwner(): never {
    throw new Error('not implemented: S04 (media owner adoption)');
  }

  captureCompensation(): never {
    throw new Error('not implemented: S05 (restore(version) compensation)');
  }

  compensate(): never {
    throw new Error('not implemented: S05 (restore(version) compensation)');
  }

  captureDetached(): never {
    throw new Error('not implemented: S05 (detached publication)');
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
    this.tentativeRows = rowsAfter;
    this.queue = this.queue.then(() => this.runStep(rowsAfter, build));
  }

  private async runStep(rowsAfter: number, build: EditBuilder): Promise<void> {
    if (this.failure !== undefined) return;
    try {
      const edits = await build(this.session.store.snapshot());
      const group = await this.session.store.commitDetailed(edits);
      if (group.after.rows !== rowsAfter) {
        throw new Error(
          `The journal holds ${group.after.rows} rows after commit ${group.ack.commitSeq}, the history promised ${rowsAfter}`,
        );
      }
      this.ack = group.ack;
    } catch (error) {
      this.failure = { error };
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('The journal history store is disposed');
    if (this.failure !== undefined) throw this.failure.error;
  }
}
