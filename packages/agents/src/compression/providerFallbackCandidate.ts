/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { CompressionIndexedRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { sanitizeProviderContentForSerialization } from '@vybestack/llxprt-code-core/services/history/historyCloneUtils.js';
import { appendCandidateRow } from './curatedCandidate.js';

export interface ProviderFallbackCandidate {
  readonly rows: CompressionIndexedRows;
  readonly start: number;
  readonly hasPendingRows: boolean;
  /**
   * The ordinal in the history of the row at `index`; such a row keeps that
   * row's owner. A row with none (or a candidate without this) comes from no
   * history row and is written under the operation's origin.
   */
  readonly sourceOrdinalAt?: (
    index: number,
  ) => number | undefined | Promise<number | undefined>;
}

export class ProviderFallbackInvariantError extends Error {}

export async function publishProviderFallbackCandidate(
  history: Pick<HistoryService, 'detachedValues'>,
  candidate: ProviderFallbackCandidate,
  model: string,
): Promise<void> {
  const { rows, start, sourceOrdinalAt } = candidate;
  if (!Number.isInteger(start) || start < 0 || start > rows.length)
    throw new ProviderFallbackInvariantError(
      'Invalid provider fallback candidate range',
    );
  await history.detachedValues.transform(async (_source, sink) => {
    for (let index = start; index < rows.length; index++) {
      const original = await rows.readRow(index);
      if (original.blocks.length === 0) continue;
      const [row] = invalidateResponsesStatefulChain([original]);
      await appendCandidateRow(
        sink,
        sanitizeProviderContentForSerialization(row),
        await sourceOrdinalAt?.(index),
      );
    }
  }, model);
}
