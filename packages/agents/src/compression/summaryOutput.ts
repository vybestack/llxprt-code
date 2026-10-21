/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionInputRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import { assertRowIndex } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

export type CompressionOutputRows = CompressionInputRows;

export async function* streamCompressionOutputRows(
  candidate: CompressionOutputRows,
  start = 0,
  signal?: AbortSignal,
): AsyncGenerator<{
  readonly row: IContent;
  readonly position: number;
  readonly sourceOrdinal: number | undefined;
}> {
  for (let position = start; position < candidate.length; position++) {
    signal?.throwIfAborted();
    const row = await candidate.readRow(position);
    const sourceOrdinal = await candidate.sourceOrdinalAt(position);
    signal?.throwIfAborted();
    yield { row, position, sourceOrdinal };
  }
}

export type SummaryOutput =
  | { readonly kind: 'noop' }
  | {
      readonly kind: 'applied';
      readonly top: number;
      readonly candidate: CompressionOutputRows;
    };

export function summaryOutput(
  source: CompressionOutputRows,
  top: number,
  bottom: number,
  summary: readonly IContent[],
): SummaryOutput {
  const length = top + summary.length + source.length - bottom;
  const sourcePosition = (index: number): number | undefined => {
    assertRowIndex(index, length);
    if (index < top) return index;
    if (index < top + summary.length) return undefined;
    return bottom + index - top - summary.length;
  };
  return {
    kind: 'applied',
    top,
    candidate: {
      length,
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < length; index++) {
          const position = sourcePosition(index);
          yield position === undefined
            ? summary[index - top]
            : await source.readRow(position);
        }
      },
      readRow(index) {
        const position = sourcePosition(index);
        return position === undefined
          ? summary[index - top]
          : source.readRow(position);
      },
      sourceOrdinalAt(index) {
        const position = sourcePosition(index);
        return position === undefined
          ? undefined
          : source.sourceOrdinalAt(position);
      },
    },
  };
}
