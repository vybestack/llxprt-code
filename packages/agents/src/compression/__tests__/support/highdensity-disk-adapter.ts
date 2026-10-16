/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { HighDensityStrategy } from '../../HighDensityStrategy.js';

export type HighDensityDiskOutcome =
  | {
      readonly kind: 'applied';
      readonly newHistory: IContent[];
      /** Leading candidate rows dropped to meet the token target. */
      readonly start: number;
    }
  | {
      readonly kind: 'noop';
      /** Rows left in the candidate; a noop must leave it empty. */
      readonly candidateRows: number;
    };

async function collect(
  contents: Iterable<IContent> | AsyncIterable<IContent>,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of contents) rows.push(row);
  return rows;
}

/**
 * Runs HighDensityStrategy.compressDisk over an in-memory row list and
 * returns the surviving rows, so behavior tests exercise the production disk
 * route while asserting on plain arrays.
 */
export async function compressHighDensityViaDisk(
  context: CompressionContext,
): Promise<HighDensityDiskOutcome> {
  const source = new HistoryDensityRows();
  const candidate = new HistoryDensityRows();
  try {
    for (const row of context.history) source.append(row);
    const result = await new HighDensityStrategy().compressDisk(
      {
        ...context,
        history: source,
        estimateTokens: async (contents) =>
          context.estimateTokens(await collect(contents)),
      },
      candidate,
    );
    if (result.kind === 'noop')
      return { kind: 'noop', candidateRows: candidate.length };
    return {
      kind: 'applied',
      newHistory: [...candidate].slice(result.start),
      start: result.start,
    };
  } finally {
    candidate.close();
    source.close();
  }
}
