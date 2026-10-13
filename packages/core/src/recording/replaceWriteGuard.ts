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
  private openTxId: string | null = null;

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
        if (this.openTxId !== null)
          throw new ReplaceTransactionConflict(
            `begin ${txId} while transaction ${this.openTxId} is open`,
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

  private observe(type: string, payload: unknown): void {
    switch (type) {
      case 'replace_begin':
        this.openTxId = requireTxId(payload);
        return;
      case 'replace_commit':
      case 'replace_abort':
        this.openTxId = null;
        return;
      case 'content':
        if (contentTxId(payload) === undefined) this.openTxId = null;
        return;
      default:
        if (HISTORY_RECORD_TYPES.has(type)) this.openTxId = null;
    }
  }

  reset(): void {
    this.openTxId = null;
  }

  private requireOpen(txId: string, what: string): void {
    if (this.openTxId === txId) return;
    const open =
      this.openTxId === null
        ? 'no transaction is open'
        : `transaction ${this.openTxId} is open`;
    throw new ReplaceTransactionConflict(`${what} for ${txId} but ${open}`);
  }
}
