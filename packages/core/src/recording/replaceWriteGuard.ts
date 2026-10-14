/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  HISTORY_RECORD_TYPES,
  contentTxId,
  requireTxId,
} from './replaceTransaction.js';

/**
 * Raised when a record would continue a replace transaction that is not the
 * open one. Every reader rejects such a journal, so the recorder refuses to
 * write it instead of leaving the session permanently unreadable.
 */
export class ReplaceTransactionConflict extends Error {
  constructor(message: string) {
    super(`Replace transaction conflict: ${message}`);
    this.name = 'ReplaceTransactionConflict';
  }
}

/**
 * The write-side counterpart of `ReplaceTransactionFold`. The recorder is the
 * single appender of its journal, so it is where the transaction grammar is
 * enforced: a transaction begins only when none is open, its tagged rows and
 * its commit or abort must name the open transaction, and any other history
 * record abandons it (a later row, commit or abort of the abandoned
 * transaction is refused). Records that do not change history, such as
 * provider switches or session events, pass through.
 */
export class ReplaceWriteGuard {
  private open: string | null = null;

  /** The transaction the journal written so far leaves open, if any. */
  get openTxId(): string | null {
    return this.open;
  }

  /**
   * Admit a record about to be appended: throws when it cannot follow the
   * journal written so far, otherwise advances the open-transaction state.
   */
  admit(type: string, payload: unknown): void {
    this.verify(type, payload);
    this.observe(type, payload);
  }

  private verify(type: string, payload: unknown): void {
    switch (type) {
      case 'replace_begin': {
        const txId = requireTxId(payload);
        if (this.open !== null)
          throw new ReplaceTransactionConflict(
            `begin ${txId} while transaction ${this.open} is open`,
          );
        return;
      }
      case 'replace_commit':
      case 'replace_abort':
        this.requireOpen(requireTxId(payload), type);
        return;
      case 'content': {
        const txId = contentTxId(payload);
        if (txId !== undefined) this.requireOpen(txId, 'row');
        return;
      }
      default:
        return;
    }
  }

  /**
   * Advance the open-transaction state past a record already in the journal.
   * Resume uses this to learn whether the file ends inside a transaction.
   */
  observe(type: string, payload: unknown): void {
    switch (type) {
      case 'replace_begin':
        this.open = requireTxId(payload);
        return;
      case 'replace_commit':
      case 'replace_abort':
        this.open = null;
        return;
      case 'content':
        if (contentTxId(payload) === undefined) this.open = null;
        return;
      default:
        if (HISTORY_RECORD_TYPES.has(type)) this.open = null;
    }
  }

  /**
   * Start tracking a journal that ends inside transaction `openTxId`, or
   * outside any transaction when null.
   */
  resume(openTxId: string | null): void {
    this.open = openTxId;
  }

  private requireOpen(txId: string, what: string): void {
    if (this.open === txId) return;
    const open =
      this.open === null
        ? 'no transaction is open'
        : `transaction ${this.open} is open`;
    throw new ReplaceTransactionConflict(`${what} for ${txId} but ${open}`);
  }
}
