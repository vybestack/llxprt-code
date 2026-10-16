/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { IContent } from './IContent.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type {
  HistoryJournalStore,
  HistoryJournalOp,
} from './historyJournalStore.js';
import { trackMutationOwners } from './historyMutationOwnership.js';
import { journalPublicationOwners } from './historyPublicationOwners.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import { densityShapeOps } from './detachedDensityOps.js';
import { historyOriginId } from './historyOriginId.js';
import { replaceOwnedRowsOps } from './historyReplaceOps.js';
import type { HistoryRowOrigins } from './historyRowOrigins.js';

interface TruncationCut {
  readonly itemsRemoved: number;
  readonly cutSeq: number | undefined;
}

/**
 * Detects a replacement that only drops the tail of the journal: every
 * replacement row equals the row at the same position. The tail then needs one
 * rewind rather than a rewind of everything plus a re-record of the kept rows.
 */
function truncationCut(
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
): TruncationCut | undefined {
  if (next.length === 0 || next.length >= previous.length) return undefined;
  const old: Iterator<IContent> = previous[Symbol.iterator]();
  try {
    for (const row of next) {
      const prior = old.next();
      if (prior.done === true || !isDeepStrictEqual(prior.value, row))
        return undefined;
    }
    const firstRemoved = old.next();
    const seq =
      firstRemoved.done === true
        ? undefined
        : firstRemoved.value.metadata?.chronology?.seq;
    return {
      itemsRemoved: previous.length - next.length,
      cutSeq: typeof seq === 'number' ? seq : undefined,
    };
  } finally {
    old.return?.();
  }
}

/** True when the replacement is value-identical to the journal, row for row. */
function rowsUnchanged(
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
): boolean {
  if (next.length !== previous.length) return false;
  const old: Iterator<IContent> = previous[Symbol.iterator]();
  try {
    for (const row of next) {
      const prior = old.next();
      if (prior.done === true || !isDeepStrictEqual(prior.value, row))
        return false;
    }
    return true;
  } finally {
    old.return?.();
  }
}

/**
 * Detects the compression shape: one summary row replacing a journal whose
 * rows all carry chronology markers. It is recorded as a compression detail
 * plus one `compressed` event, never as a rewind and a content row.
 */
function compressionOps(
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
  nextOrigins: HistoryRowOrigins | undefined,
): HistoryJournalOp[] | undefined {
  if (next.length !== 1 || previous.length === 0) return undefined;
  let fromSeq: number | undefined;
  let toSeq = 0;
  for (const row of previous) {
    const seq = row.metadata?.chronology?.seq;
    if (typeof seq !== 'number') return undefined;
    fromSeq ??= seq;
    toSeq = seq;
  }
  let summary: IContent | undefined;
  for (const row of next) summary = row;
  if (summary === undefined) return undefined;
  const summaryOrigin = nextOrigins?.originAt(0);
  return [
    {
      kind: 'compressionDetail',
      payload: {
        fromSeq: fromSeq ?? 0,
        toSeq,
        itemsCompressed: previous.length,
      },
    },
    {
      kind: 'compressed',
      summary,
      itemsCompressed: previous.length,
      ...(summaryOrigin === undefined ? {} : { origin: summaryOrigin }),
    },
  ];
}

interface ReplaceTransaction {
  readonly txId: string;
  rows: number;
}

export class DetachedHistoryPublication {
  admittedCount = 0;
  /**
   * True once a replacement is durable: the commit record of a transaction, or
   * the acknowledged single record of an optimised shape. The durable fold then
   * holds the new rows; before that it still holds the previous rows.
   */
  replacementDurable = false;
  private transaction: ReplaceTransaction | null = null;
  private releaseEnvelope = (): void => {};

  /**
   * `rowOrigins` is given when the candidate puts back rows that had owners (a
   * rollback to a checkpoint): each row is then written under the origin it
   * had, and the publication names no origin of its own.
   */
  constructor(
    private readonly journal: HistoryJournalStore,
    private readonly ownership?: RowOwnership,
    origin?: object,
    private readonly rowOrigins?: HistoryRowOrigins,
  ) {
    if (origin !== undefined && rowOrigins !== undefined)
      throw new Error('A restoring publication cannot name an origin');
    this.origin = origin === undefined ? undefined : historyOriginId(origin);
  }

  private readonly origin: string | undefined;

  async publish(
    previous: DetachedHistoryJournal,
    next: DetachedHistoryJournal,
    signal?: AbortSignal,
    appendOnly = false,
    awaitFinalCommit = true,
    densityShape = false,
  ): Promise<void> {
    if (!appendOnly && rowsUnchanged(previous, next)) return;
    if (densityShape && !appendOnly) {
      const density = densityShapeOps(previous, next, this.ownership);
      if (density !== undefined) {
        for (const op of density) await this.admit(op, signal);
        this.replacementDurable = true;
        return;
      }
    }
    const compression = appendOnly
      ? undefined
      : compressionOps(previous, next, this.rowOrigins);
    if (compression !== undefined) {
      for (const op of compression) await this.admitShape(op, signal);
      return;
    }
    const truncation = appendOnly ? undefined : truncationCut(previous, next);
    if (truncation !== undefined) {
      await this.admitShape({ kind: 'rewind', ...truncation }, signal);
      return;
    }
    if (!appendOnly && previous.length > 0) {
      if (next.length === 0) {
        await this.admitShape(
          { kind: 'rewind', itemsRemoved: previous.length },
          signal,
        );
        return;
      }
      await this.publishReplacement(next, signal, awaitFinalCommit);
      return;
    }
    let index = 0;
    for (const content of next) {
      const ordinal = index++;
      if (!appendOnly || ordinal >= previous.length)
        await this.admit(
          this.rowOp(content, ordinal),
          signal,
          ordinal < next.length - 1 || awaitFinalCommit,
        );
    }
    signal?.throwIfAborted();
  }

  /**
   * Stream a general replacement as one journal transaction. Every reader
   * folds an unfinished transaction to the previous rows, so a crash or write
   * failure before the commit record is durable never loses committed history.
   */
  private async publishReplacement(
    next: DetachedHistoryJournal,
    signal: AbortSignal | undefined,
    awaitFinalCommit: boolean,
  ): Promise<void> {
    const open: ReplaceTransaction = { txId: randomUUID(), rows: 0 };
    const { txId } = open;
    this.transaction = open;
    await this.admit({ kind: 'replaceBegin', txId }, signal);
    let ordinal = 0;
    for (const content of next)
      await this.admit(
        this.rowOp(content, ordinal++, txId),
        signal,
        true,
        () => {
          open.rows++;
        },
      );
    await this.admit(
      { kind: 'replaceCommit', txId, rowCount: open.rows },
      signal,
      awaitFinalCommit,
      () => {
        this.replacementDurable = true;
      },
    );
    signal?.throwIfAborted();
  }

  /** A row of the candidate; a restoring publication keeps the origin the row had. */
  private rowOp(
    content: IContent,
    ordinal: number,
    tx?: string,
  ): HistoryJournalOp {
    const origin = this.rowOrigins?.originAt(ordinal);
    return {
      kind: 'content',
      content,
      ...(tx === undefined ? {} : { tx }),
      ...(origin === undefined ? {} : { origin }),
    };
  }

  private async admitShape(
    op: HistoryJournalOp,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.admit(op, signal, true, () => {
      this.replacementDurable = true;
    });
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
    const open = this.transaction;
    if (open !== null && !this.replacementDurable) {
      // The recorder is still writable here: close the unfinished transaction.
      await this.admit({
        kind: 'replaceAbort',
        txId: open.txId,
        rowCount: open.rows,
      });
      this.transaction = null;
      return;
    }
    await this.restorePrevious(previous, next);
  }

  /** Put the previous rows back after a replacement became durable. */
  private async restorePrevious(
    previous: DetachedHistoryJournal,
    next: DetachedHistoryJournal,
  ): Promise<void> {
    if (previous.length === 0) {
      await this.admit({ kind: 'rewind', itemsRemoved: next.length });
      return;
    }
    // The failed operation's origin does not apply here: each previous row
    // returns under the origin it had, and unowned rows stay unowned.
    for (const op of replaceOwnedRowsOps(previous.origins.owned(previous)))
      await this.admitOp(op);
  }

  private admit(
    op: HistoryJournalOp,
    signal?: AbortSignal,
    awaitCommit = true,
    onDurable?: () => void,
  ): Promise<void> {
    return this.admitOp(
      this.origin === undefined ? op : { ...op, origin: this.origin },
      signal,
      awaitCommit,
      onDurable,
    );
  }

  private async admitOp(
    op: HistoryJournalOp,
    signal?: AbortSignal,
    awaitCommit = true,
    onDurable?: () => void,
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
        // The deferred acknowledgement cannot be awaited; admission is the last word.
        onDurable?.();
        return;
      }
      await acknowledgement;
      onDurable?.();
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
