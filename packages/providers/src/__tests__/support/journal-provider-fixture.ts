/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { withCoreSuffixFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryCase } from './wireBodyHistories.js';
import { closeInOrder } from './close-in-order.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { prepareProviderContentSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';

export function eagerProviderOracle(input: HistoryCase): HistoryCase {
  const logger = new DebugLogger('native-provider-eager-oracle');
  return {
    ...input,
    rows: buildProviderContent(
      buildCuratedHistory(logger, structuredClone([...input.rows]), false),
      [],
      logger,
    ),
  };
}

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
  curation: 'history' | 'provider-only' = 'history',
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
      const source = transaction?.requestRows(true);
      const selection =
        curation === 'history'
          ? await history.prepareCuratedForProviderSnapshot(
              [],
              { ownership },
              source,
            )
          : await prepareProviderContentSnapshot(
              source ?? history.streamRawHistory(),
              [],
              new DebugLogger('native-provider-normalized-fixture'),
              { ownership },
            );
      let failure: { readonly error: unknown } | undefined;
      try {
        const result = await action(selection, history);
        if (selection.count > 0)
          expect(() => selection.readAt(0)).not.toThrow();
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(counters.snapshot().peakDecodedRows).toBe(1);
        return result;
      } catch (error) {
        failure = { error };
        throw error;
      } finally {
        await closeInOrder(failure, selection, transaction);
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
