/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { MutableRowDirectory } from './mutableRowDirectory.js';
import type { ResolverDiskIndex } from './resolverDiskIndex.js';

/**
 * Replace transactions make a streamed history replacement atomic inside the
 * single journal. The writer emits `replace_begin`, then the replacement rows
 * as `content` records tagged with the transaction id, then `replace_commit`.
 * Every reader folds the records with the one rule implemented here:
 *
 * - begin remembers `base`, the number of rows before the transaction;
 * - tagged rows append at the tail like any other row;
 * - commit checks that exactly `rowCount` rows were appended, then drops the
 *   `base` rows that preceded the transaction;
 * - abort, any history record that is not a row of the open transaction (a
 *   resume after a crash), or the end of input truncates back to `base`, so an
 *   unfinished transaction never existed;
 * - a malformed transaction (nested begin, commit or row without a matching
 *   begin, wrong id, wrong row count) throws.
 *
 * Only the scalar `base` and the open transaction id are retained.
 */

/** Row container operations the fold rule needs from a reader's row store. */
export interface ReplaceRowStore {
  readonly length: number;
  truncate(length: number): void;
  /** Remove the first `count` rows, keeping the order of the rest. */
  dropPrefix(count: number): void;
}

export interface OpenReplaceTransaction {
  readonly txId: string;
  readonly base: number;
}

/** Record types that change history membership and so interrupt an open transaction. */
export const HISTORY_RECORD_TYPES: ReadonlySet<string> = new Set([
  'content',
  'compressed',
  'rewind',
  'compression_detail',
  'density_mutation',
  'synthetic_insert',
  'chronology_bind',
  'semantic_media_purge',
]);

export const REPLACE_RECORD_TYPES: ReadonlySet<string> = new Set([
  'replace_begin',
  'replace_commit',
  'replace_abort',
]);

export class MalformedReplaceTransaction extends Error {
  constructor(message: string) {
    super(`Malformed replace transaction: ${message}`);
    this.name = 'MalformedReplaceTransaction';
  }
}

export class ReplaceTransactionFold {
  private current: OpenReplaceTransaction | null;

  constructor(open: OpenReplaceTransaction | null = null) {
    this.current = open;
  }

  get open(): OpenReplaceTransaction | null {
    return this.current;
  }

  begin(txId: string, store: ReplaceRowStore): void {
    if (this.current !== null)
      throw new MalformedReplaceTransaction(
        `begin ${txId} inside open transaction ${this.current.txId}`,
      );
    this.current = { txId, base: store.length };
  }

  /** Validate a tagged row; the caller appends it like any other row. */
  accept(txId: string): void {
    if (this.current?.txId !== txId)
      throw new MalformedReplaceTransaction(
        `row for ${txId} outside its transaction`,
      );
  }

  commit(txId: string, rowCount: number, store: ReplaceRowStore): void {
    const open = this.requireOpen(txId, 'commit');
    if (store.length - open.base !== rowCount)
      throw new MalformedReplaceTransaction(
        `commit ${txId} declares ${rowCount} rows but ${store.length - open.base} were written`,
      );
    this.current = null;
    store.dropPrefix(open.base);
  }

  abort(txId: string, store: ReplaceRowStore): void {
    const open = this.requireOpen(txId, 'abort');
    this.current = null;
    store.truncate(open.base);
  }

  /**
   * An open transaction that is followed by an unrelated history record, or by
   * the end of input, was never committed: drop its rows.
   */
  abandon(store: ReplaceRowStore): void {
    const open = this.current;
    if (open === null) return;
    this.current = null;
    store.truncate(open.base);
  }

  private requireOpen(txId: string, what: string): OpenReplaceTransaction {
    if (this.current?.txId !== txId)
      throw new MalformedReplaceTransaction(
        `${what} ${txId} without its begin`,
      );
    return this.current;
  }
}

function recordField(payload: unknown, key: string): unknown {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)[key]
    : undefined;
}

/** The transaction id of a payload that must carry one; throws otherwise. */
export function requireTxId(payload: unknown): string {
  const txId = recordField(payload, 'txId');
  if (typeof txId !== 'string' || txId === '')
    throw new MalformedReplaceTransaction('missing txId');
  return txId;
}

/** The `tx` tag of a content payload, when it belongs to a transaction. */
export function contentTxId(payload: unknown): string | undefined {
  const tx = recordField(payload, 'tx');
  if (tx === undefined) return undefined;
  if (typeof tx !== 'string' || tx === '')
    throw new MalformedReplaceTransaction('invalid row tx tag');
  return tx;
}

export function requireRowCount(payload: unknown): number {
  const count = recordField(payload, 'rowCount');
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
    throw new MalformedReplaceTransaction('invalid rowCount');
  return count;
}

/**
 * Apply a replace record (`replace_begin`/`commit`/`abort`) to a store.
 * Returns false when the type is not a replace record.
 */
export function applyReplaceRecord(
  fold: ReplaceTransactionFold,
  type: string,
  payload: unknown,
  store: ReplaceRowStore,
): boolean {
  switch (type) {
    case 'replace_begin':
      fold.begin(requireTxId(payload), store);
      return true;
    case 'replace_commit':
      fold.commit(requireTxId(payload), requireRowCount(payload), store);
      return true;
    case 'replace_abort':
      fold.abort(requireTxId(payload), store);
      return true;
    default:
      return false;
  }
}

/**
 * Called before a history record is applied. Returns true when the record is
 * a row of the open transaction (the caller appends it normally); otherwise
 * an open transaction is abandoned first.
 */
export function enterHistoryRecord(
  fold: ReplaceTransactionFold,
  type: string,
  payload: unknown,
  store: ReplaceRowStore,
): void {
  const tx = type === 'content' ? contentTxId(payload) : undefined;
  if (tx !== undefined) fold.accept(tx);
  else fold.abandon(store);
}

export function directoryRowStore(
  directory: MutableRowDirectory,
): ReplaceRowStore {
  return {
    get length() {
      return directory.length;
    },
    truncate: (length) => directory.truncate(length),
    dropPrefix: (count) => {
      directory.compact((_row, index) => index >= count);
    },
  };
}

export function diskIndexRowStore(index: ResolverDiskIndex): ReplaceRowStore {
  return {
    get length() {
      return index.length;
    },
    truncate: (length) => index.truncate(length),
    dropPrefix: (count) => {
      for (let read = count; read < index.length; read += 1)
        index.set(read - count, index.get(read));
      index.truncate(index.length - count);
    },
  };
}

export function arrayRowStore<T>(rows: T[]): ReplaceRowStore {
  return {
    get length() {
      return rows.length;
    },
    truncate: (length) => {
      rows.length = length;
    },
    dropPrefix: (count) => {
      rows.splice(0, count);
    },
  };
}
