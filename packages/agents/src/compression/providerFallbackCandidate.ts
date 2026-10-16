/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { sanitizeProviderContentForSerialization } from '@vybestack/llxprt-code-core/services/history/historyCloneUtils.js';

export interface ProviderFallbackCandidate {
  readonly rows: HistoryIndexedRows;
  readonly start: number;
  readonly hasPendingRows: boolean;
}

export class ProviderFallbackInvariantError extends Error {}

export async function publishProviderFallbackCandidate(
  history: HistoryService,
  candidate: ProviderFallbackCandidate,
  model: string,
): Promise<void> {
  const { rows, start } = candidate;
  if (!Number.isInteger(start) || start < 0 || start > rows.length)
    throw new ProviderFallbackInvariantError(
      'Invalid provider fallback candidate range',
    );
  await history.detachedValues.transform(async (_source, sink) => {
    for (let index = start; index < rows.length; index++) {
      const original = rows.readRow(index);
      if (original.blocks.length === 0) continue;
      const [row] = invalidateResponsesStatefulChain([original]);
      sink.appendValue(sanitizeProviderContentForSerialization(row));
    }
  }, model);
}
