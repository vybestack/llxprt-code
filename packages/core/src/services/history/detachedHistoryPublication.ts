/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
  return [
    {
      kind: 'compressionDetail',
      payload: {
        fromSeq: fromSeq ?? 0,
        toSeq,
        itemsCompressed: previous.length,
      },
    },
    { kind: 'compressed', summary, itemsCompressed: previous.length },
  ];
}

export class DetachedHistoryPublication {
  admittedCount = 0;
  private releaseEnvelope = (): void => {};

  constructor(
    private readonly journal: HistoryJournalStore,
    private readonly ownership?: RowOwnership,
  ) {}

  async publish(
    previous: DetachedHistoryJournal,
    next: DetachedHistoryJournal,
    signal?: AbortSignal,
    appendOnly = false,
    awaitFinalCommit = true,
  ): Promise<void> {
    if (!appendOnly && rowsUnchanged(previous, next)) return;
    const compression = appendOnly ? undefined : compressionOps(previous, next);
    if (compression !== undefined) {
      for (const op of compression) await this.admit(op, signal);
      return;
    }
    const truncation = appendOnly ? undefined : truncationCut(previous, next);
    if (truncation !== undefined) {
      await this.admit({ kind: 'rewind', ...truncation }, signal);
      return;
    }
    if (!appendOnly && previous.length > 0)
      await this.admit(
        { kind: 'rewind', itemsRemoved: previous.length },
        signal,
      );
    let index = 0;
    for (const content of next) {
      const ordinal = index++;
      if (!appendOnly || ordinal >= previous.length)
        await this.admit(
          { kind: 'content', content },
          signal,
          ordinal < next.length - 1 || awaitFinalCommit,
        );
    }
    signal?.throwIfAborted();
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
    await this.admit({
      kind: 'rewind',
      itemsRemoved: previous.length + next.length,
    });
    for (const content of previous)
      await this.admit({ kind: 'content', content });
  }

  private async admit(
    op: HistoryJournalOp,
    signal?: AbortSignal,
    awaitCommit = true,
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
        return;
      }
      await acknowledgement;
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
