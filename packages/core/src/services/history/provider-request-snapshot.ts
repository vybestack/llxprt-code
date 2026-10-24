/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { NativeProviderFormat } from './native-provider-format.js';

export interface ProviderRequestRows {
  readonly callerOwned?: true;
  readonly native?: NativeProviderFormat;
  readonly count: number;
  readonly openReader: (
    signal?: AbortSignal,
  ) => AsyncGenerator<IContent, void, unknown>;
  /**
   * Random access to one row by its position in the selection, without
   * reading the rows before it. The caller owns the returned row and holds
   * only that one; it is not counted by a reader's row ownership.
   * Throws a RangeError for a position outside `0..count-1`.
   */
  readonly readAt: (
    index: number,
    signal?: AbortSignal,
  ) => IContent | Promise<IContent>;
}

/** Shared range rule for every `readAt` implementation. */
export function assertRowIndex(index: number, count: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= count)
    throw new RangeError('Provider request row index is out of range');
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

export interface ProviderRequestSource extends AsyncIterable<IContent> {
  openProviderRequest(signal?: AbortSignal): Promise<ProviderRequestSelection>;
}

export function isProviderRequestSource(
  source: AsyncIterable<IContent>,
): source is ProviderRequestSource {
  return (
    'openProviderRequest' in source &&
    typeof source.openProviderRequest === 'function'
  );
}

/** A selection over rows already resident in memory; closing it releases nothing. */
export function inMemoryRequestSelection(
  rows: readonly IContent[],
): ProviderRequestSelection {
  let boundaryIdentity: object | undefined;
  for (const row of rows) {
    const boundary = row.metadata?.semanticMediaPurgeBoundary;
    if (boundary === undefined) continue;
    if (
      boundaryIdentity !== undefined &&
      boundaryIdentity !== boundary.boundaryId
    )
      throw new Error(
        'Provider request has conflicting semantic purge boundaries',
      );
    boundaryIdentity = boundary.boundaryId;
  }
  return {
    count: rows.length,
    async *openReader(signal) {
      for (const row of rows) {
        signal?.throwIfAborted();
        yield row;
      }
    },
    readAt(index, signal) {
      signal?.throwIfAborted();
      assertRowIndex(index, rows.length);
      return rows[index];
    },
    close: () => undefined,
  };
}

export function providerRequestRows(
  snapshot: ProviderRequestRows,
): ProviderRequestRows {
  return Object.freeze({
    ...(snapshot.native === undefined ? {} : { native: snapshot.native }),
    ...(snapshot.callerOwned === true ? { callerOwned: true } : {}),
    count: snapshot.count,
    openReader: (signal?: AbortSignal) => snapshot.openReader(signal),
    readAt: (index: number, signal?: AbortSignal) =>
      snapshot.readAt(index, signal),
  });
}

export interface ProviderRequestSnapshot extends ProviderRequestSelection {
  /** Pending output may be reordered, so firstOutputIndex is not a suffix boundary. */
  readonly pending: {
    readonly inputCount: number;
    readonly firstOutputIndex: number | undefined;
  };
  isPending(index: number): boolean;
}

export async function* streamProviderContentSnapshot(
  snapshot: ProviderRequestSnapshot,
): AsyncGenerator<IContent, void, unknown> {
  try {
    yield* snapshot.openReader();
  } finally {
    await snapshot.close();
  }
}
