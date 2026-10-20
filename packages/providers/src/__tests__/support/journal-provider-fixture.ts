/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { withCoreSuffixFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryCase } from './wireBodyHistories.js';

function guardedHistory(
  options?: ConstructorParameters<typeof HistoryService>[0],
): HistoryService {
  const history = new HistoryService(options);
  forbidHistoryMaterializationForTest(
    history,
    'native provider eagerly read history',
  );
  return history;
}

export async function withJournalProviderSelection<T>(
  input: HistoryCase,
  action: (
    selection: ProviderRequestSnapshot,
    history: HistoryService,
  ) => Promise<T>,
): Promise<T> {
  return withCoreSuffixFixture(
    input.rows.length,
    async (history, ownership, counters) => {
      const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
        enabled: input.rows.some(
          (row) => row.metadata?.semanticMediaPurgeBoundary !== undefined,
        ),
        explicitCacheWriteRequired: true,
      });
      const transaction = await coordinator.begin({ mode: 'remove' });
      const selection = await history.prepareCuratedForProviderSnapshot(
        [],
        { ownership },
        transaction?.requestRows(true),
      );
      try {
        const result = await action(selection, history);
        if (selection.count > 0)
          expect(() => selection.readAt(0)).not.toThrow();
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(counters.snapshot().peakDecodedRows).toBe(1);
        return result;
      } finally {
        selection.close();
        transaction?.close();
        expect(() => selection.openReader()).toThrow('closed');
        expect(ownership.snapshot().liveRows).toBe(0);
      }
    },
    0,
    (index) => structuredClone(input.rows[index]),
    undefined,
    guardedHistory,
    'journal',
  );
}

export const forbiddenProviderContents: AsyncIterable<IContent> = {
  [Symbol.asyncIterator](): AsyncGenerator<IContent, void> {
    throw new Error('native selected send fell back to contents');
  },
};
