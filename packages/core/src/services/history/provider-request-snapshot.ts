/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import type { ProviderNormalizationDisk } from './provider-normalization-disk.js';

export interface ProviderRequestRows {
  readonly count: number;
  readonly openReader: (
    signal?: AbortSignal,
  ) => AsyncGenerator<IContent, void, unknown>;
}

/**
 * The provider-neutral request selection: immutable count/membership, a
 * repeatable `openReader(signal)` and an explicit close owner. The party that
 * hands it to the send seam transfers the close obligation; providers and
 * wrappers only read it.
 */
export interface ProviderRequestSelection extends ProviderRequestRows {
  close(): void | Promise<void>;
}

/** A selection over rows already resident in memory; closing it releases nothing. */
export function inMemoryRequestSelection(
  rows: readonly IContent[],
): ProviderRequestSelection {
  return {
    count: rows.length,
    async *openReader(signal) {
      for (const row of rows) {
        signal?.throwIfAborted();
        yield row;
      }
    },
    close: () => undefined,
  };
}

export function providerRequestRows(
  snapshot: ProviderRequestSnapshot,
): ProviderRequestRows {
  return Object.freeze({
    count: snapshot.count,
    openReader: (signal?: AbortSignal) => snapshot.openReader(signal),
  });
}

export interface ProviderRequestSnapshot extends ProviderRequestSelection {
  /** Pending output may be reordered, so firstOutputIndex is not a suffix boundary. */
  readonly pending: {
    readonly inputCount: number;
    readonly firstOutputIndex: number | undefined;
  };
  isPending(index: number): boolean;
  close(): void;
}

export async function* streamProviderContentSnapshot(
  snapshot: ProviderRequestSnapshot,
): AsyncGenerator<IContent, void, unknown> {
  try {
    yield* snapshot.openReader();
  } finally {
    snapshot.close();
  }
}

export class NormalizedProviderRequestSnapshot
  implements ProviderRequestSnapshot
{
  readonly count: number;
  readonly pending: ProviderRequestSnapshot['pending'];
  private disk: ProviderNormalizationDisk | undefined;
  private readonly readers = new Set<ProviderSnapshotReader>();
  private failure: unknown = new Error('Provider request snapshot is closed');
  private readonly onAbort = (): void => this.dispose(this.signal?.reason);

  constructor(
    disk: ProviderNormalizationDisk,
    pendingInputCount: number,
    private readonly signal?: AbortSignal,
    private readonly ownership?: RowOwnership,
  ) {
    this.disk = disk;
    this.count = disk.number('length:ordered') ?? 0;
    this.pending = Object.freeze({
      inputCount: pendingInputCount,
      firstOutputIndex: disk.number('pending:first-output'),
    });
    signal?.throwIfAborted();
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  private storage(): ProviderNormalizationDisk {
    if (this.disk === undefined) throw this.failure;
    return this.disk;
  }

  isPending(index: number): boolean {
    const disk = this.storage();
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new RangeError('Provider snapshot index is out of range');
    return disk.number(`pending:ordered:${index}`) === 1;
  }

  openReader(signal?: AbortSignal): AsyncGenerator<IContent, void, unknown> {
    this.storage();
    signal?.throwIfAborted();
    const reader = new ProviderSnapshotReader(this, this.ownership, signal);
    this.readers.add(reader);
    return reader;
  }

  read(index: number): IContent {
    return this.storage().row('ordered', index);
  }

  release(reader: ProviderSnapshotReader): void {
    this.readers.delete(reader);
  }

  close(): void {
    this.dispose(new Error('Provider request snapshot is closed'));
  }

  private dispose(reason: unknown): void {
    const disk = this.disk;
    if (disk === undefined) return;
    this.disk = undefined;
    this.failure = reason;
    this.signal?.removeEventListener('abort', this.onAbort);
    for (const reader of this.readers) reader.fail(reason);
    disk.close();
  }
}

class ProviderSnapshotReader
  implements AsyncGenerator<IContent, void, unknown>
{
  private index = 0;
  private row: IContent | undefined;
  private failed = false;
  private failure: unknown;
  private readonly onAbort = (): void => this.fail(this.signal?.reason);

  constructor(
    private owner: NormalizedProviderRequestSnapshot | undefined,
    private readonly ownership?: RowOwnership,
    private readonly signal?: AbortSignal,
  ) {
    signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  [Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
    return this;
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.finish();
    return Promise.resolve();
  }

  next(): Promise<IteratorResult<IContent, void>> {
    try {
      if (this.failed) throw this.failure;
      this.releaseRow();
      const owner = this.owner;
      if (owner === undefined || this.index === owner.count) {
        this.finish();
        return Promise.resolve({ done: true, value: undefined });
      }
      const row = owner.read(this.index++);
      this.ownership?.retain(row);
      this.row = row;
      return Promise.resolve({ done: false, value: row });
    } catch (error) {
      this.fail(error);
      return Promise.reject(error);
    }
  }

  return(): Promise<IteratorResult<IContent, void>> {
    this.finish();
    return Promise.resolve({ done: true, value: undefined });
  }

  throw(error?: unknown): Promise<IteratorResult<IContent, void>> {
    this.fail(error);
    return Promise.reject(error);
  }

  fail(error: unknown): void {
    this.failed = true;
    this.failure = error;
    this.finish();
  }

  private releaseRow(): void {
    if (this.row === undefined) return;
    this.ownership?.release(this.row);
    this.row = undefined;
  }

  private finish(): void {
    this.releaseRow();
    this.signal?.removeEventListener('abort', this.onAbort);
    this.owner?.release(this);
    this.owner = undefined;
  }
}
