/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionContext } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { MiddleOutStrategy } from '../../MiddleOutStrategy.js';

export type MiddleOutDiskOutcome =
  | {
      readonly kind: 'applied';
      readonly newHistory: IContent[];
      /** Rows preserved ahead of the summary. */
      readonly top: number;
      /** Rows preserved after the summary and continuation directive. */
      readonly bottom: number;
    }
  | {
      readonly kind: 'noop';
      /** Rows left in the candidate; a noop must leave it empty. */
      readonly candidateRows: number;
    };

/**
 * Runs MiddleOutStrategy.compressDisk over an in-memory row list and returns
 * the candidate rows, so behavior tests exercise the production disk route
 * while asserting on plain arrays. Layout of an applied result:
 * [...top, summary, continuation directive, ...bottom].
 */
export async function compressMiddleOutViaDisk(
  context: CompressionContext,
): Promise<MiddleOutDiskOutcome> {
  const source = new HistoryDensityRows();
  const candidate = new HistoryDensityRows();
  try {
    for (const row of context.history) source.append(row);
    const result = await new MiddleOutStrategy(
      undefined,
      undefined,
      undefined,
      undefined,
    ).compressDisk({ ...context, history: source }, candidate);
    if (result.kind === 'noop')
      return { kind: 'noop', candidateRows: candidate.length };
    const newHistory = [...candidate];
    return {
      kind: 'applied',
      newHistory,
      top: result.top,
      bottom: newHistory.length - result.top - 2,
    };
  } finally {
    candidate.close();
    source.close();
  }
}

export function requireMiddleOutApplied(
  outcome: MiddleOutDiskOutcome,
): Extract<MiddleOutDiskOutcome, { kind: 'applied' }> {
  if (outcome.kind !== 'applied')
    throw new Error('Expected the middle-out disk route to apply compression');
  return outcome;
}
