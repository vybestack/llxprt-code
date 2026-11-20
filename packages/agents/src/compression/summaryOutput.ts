/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionSourceRange } from '@vybestack/llxprt-code-core/services/history/compressionChronology.js';
import type { CompressionInputRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import { assertRowIndex } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { CompressionAuditProvenance } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { stampCompressionProvenance } from '@vybestack/llxprt-code-core/services/history/compressionProvenance.js';

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
      readonly provenance: CompressionAuditProvenance;
    };

export function summaryOutput(
  source: CompressionOutputRows,
  top: number,
  bottom: number,
  summaryRows: readonly IContent[],
  provenance: CompressionAuditProvenance,
): SummaryOutput {
  const summary = stampCompressionProvenance(summaryRows, provenance);
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
    provenance,
    candidate: {
      length,
      async chronologySelection(start) {
        const ranges: CompressionSourceRange[] = [];
        for (const [from, to] of [
          [Math.min(start, top), top],
          [
            Math.min(
              source.length,
              bottom + Math.max(0, start - top - summary.length),
            ),
            source.length,
          ],
        ]) {
          if (from === to) continue;
          const first = await source.sourceOrdinalAt(from);
          const last = await source.sourceOrdinalAt(to - 1);
          if (first === undefined || last === undefined)
            throw new Error('Summary source range has no source ordinal');
          ranges.push({ from: first, to: last + 1 });
        }
        return { ranges, generated: summary.slice(Math.max(0, start - top)) };
      },
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
