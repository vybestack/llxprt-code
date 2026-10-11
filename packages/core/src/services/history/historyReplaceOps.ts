/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type { IContent } from './IContent.js';
import type { HistoryJournalOp } from './historyJournalStore.js';

/**
 * Journal ops that replace the whole history with `rows` as one replace
 * transaction (begin, tagged rows, commit). A reader that sees the journal
 * end before the commit still holds the previous rows, so a crash while the
 * replacement streams in never loses committed history. Only the id and a row
 * counter are retained.
 *
 * Use this only to replace a non-empty history with a non-empty one. A pure
 * clear or suffix cut is a single `rewind` record and already atomic.
 */
export function* replaceAllOps(
  rows: Iterable<IContent>,
): Generator<HistoryJournalOp, void, unknown> {
  const txId = randomUUID();
  let rowCount = 0;
  yield { kind: 'replaceBegin', txId };
  for (const content of rows) {
    rowCount++;
    yield { kind: 'content', content, tx: txId };
  }
  yield { kind: 'replaceCommit', txId, rowCount };
}

/**
 * Ops that make the journal hold exactly `rows` again, whatever prefix of a
 * failed mutation it contains. `admittedBound` is an upper bound of the
 * journal's row count, used when `rows` is empty and a rewind clears it.
 */
export function* restoreRowsOps(
  rows: Iterable<IContent> & { readonly length: number },
  admittedBound: number,
): Generator<HistoryJournalOp, void, unknown> {
  if (rows.length === 0) {
    yield { kind: 'rewind', itemsRemoved: admittedBound };
    return;
  }
  yield* replaceAllOps(rows);
}

/** Tracks the replace transaction that admitted ops have left open, if any. */
export class OpenReplaceTracker {
  private current: { readonly txId: string; rows: number } | null = null;

  /** Call after the journal accepted `op`. */
  observe(op: HistoryJournalOp): void {
    switch (op.kind) {
      case 'replaceBegin':
        this.current = { txId: op.txId, rows: 0 };
        break;
      case 'content':
        if (this.current !== null && op.tx === this.current.txId)
          this.current.rows++;
        break;
      case 'replaceCommit':
      case 'replaceAbort':
        this.current = null;
        break;
      default:
        break;
    }
  }

  /** The abort op that closes the open transaction, or null when none is open. */
  abortOp(): HistoryJournalOp | null {
    return this.current === null
      ? null
      : {
          kind: 'replaceAbort',
          txId: this.current.txId,
          rowCount: this.current.rows,
        };
  }
}
