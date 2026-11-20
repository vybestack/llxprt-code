/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { CompressionRowSelection } from './compressionInput.js';
import type { TokenRowInput } from './history-token-tickets.js';

export interface TokenEstimationRows {
  tokenRows(signal?: AbortSignal): AsyncGenerator<TokenRowInput, void, unknown>;
}

export function hasTokenEstimationRows(
  value: object,
): value is TokenEstimationRows {
  return 'tokenRows' in value && typeof value.tokenRows === 'function';
}

export function compressionTokenSelection(
  rows: CompressionRowSelection,
  from = 0,
  to = rows.length,
): AsyncIterable<IContent> & TokenEstimationRows {
  if (!Number.isInteger(from) || !Number.isInteger(to))
    throw new RangeError('Compression token selection is out of range');
  if (from < 0 || to < from || to > rows.length)
    throw new RangeError('Compression token selection is out of range');
  return {
    async *[Symbol.asyncIterator]() {
      for (let index = from; index < to; index++)
        yield await rows.readRow(index);
    },
    async *tokenRows(signal) {
      for (let index = from; index < to; index++) {
        signal?.throwIfAborted();
        yield await (rows.readTokenRow?.(index) ?? rows.readRow(index));
      }
      signal?.throwIfAborted();
    },
  };
}
