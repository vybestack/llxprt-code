/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import { TopDownTruncationStrategy } from '../../TopDownTruncationStrategy.js';

async function collect(
  contents: Iterable<IContent> | AsyncIterable<IContent>,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of contents) rows.push(row);
  return rows;
}

/**
 * Runs TopDownTruncationStrategy.compressDisk over an in-memory row list and
 * reports the surviving rows, so behavior tests exercise the production disk
 * route while asserting on a plain history array.
 */
export async function compressTopDownViaDisk(
  context: CompressionContext,
): Promise<StrategyCompressionResult> {
  const rows = context.history;
  const indexed: HistoryIndexedRows = {
    length: rows.length,
    readRow: (index) => rows[index],
    [Symbol.iterator]: () => rows[Symbol.iterator](),
  };
  const result = await new TopDownTruncationStrategy().compressDisk({
    ...context,
    history: indexed,
    estimateTokens: async (contents) =>
      context.estimateTokens(await collect(contents)),
  });
  if (result.kind === 'noop') return result;
  return {
    kind: 'applied',
    newHistory: rows.slice(result.start),
    metadata: result.metadata,
  };
}
