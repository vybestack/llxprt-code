/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { OneShotStrategy } from '../../OneShotStrategy.js';

export type OneShotDiskOutcome =
  | { readonly kind: 'applied'; readonly newHistory: IContent[] }
  | { readonly kind: 'noop' };

/**
 * Runs OneShotStrategy.compressDisk over an in-memory row list and returns
 * the candidate rows, so behavior tests exercise the production disk route
 * while asserting on plain arrays.
 */
export async function compressOneShotViaDisk(
  context: CompressionContext,
): Promise<OneShotDiskOutcome> {
  const source = new HistoryDensityRows();
  const candidate = new HistoryDensityRows();
  try {
    for (const row of context.history) source.append(row);
    const result = await new OneShotStrategy().compressDisk(
      { ...context, history: source },
      candidate,
    );
    if (result.kind === 'noop') return result;
    return { kind: 'applied', newHistory: [...candidate] };
  } finally {
    candidate.close();
    source.close();
  }
}

export function requireApplied(outcome: OneShotDiskOutcome): IContent[] {
  if (outcome.kind !== 'applied')
    throw new Error('Expected the one-shot disk route to apply compression');
  return outcome.newHistory;
}
