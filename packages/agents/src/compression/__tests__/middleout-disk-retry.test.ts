/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  middleoutSetup,
  middleoutOracle,
  middleoutRow,
  SummaryTransport,
  MiddleoutDiskHistory,
} from './middleout-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';

class TransientSummaryError extends Error {
  readonly status = 503;
}
async function retry(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const expected = await middleoutOracle(history, size, 64);
      const transport = new SummaryTransport();
      let sent = 0;
      transport.beforeSend = async () => {
        if (++sent === 1)
          throw new TransientSummaryError(
            'temporary summary transport failure',
          );
      };
      const { handler } = middleoutSetup(history, transport);
      expect(await handler.performCompression('retry')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      expect(transport.requests).toStrictEqual([
        expected.requests[0],
        expected.requests[0],
      ]);
      return transport.requests.length;
    },
    64,
    middleoutRow,
    undefined,
    (options) => new MiddleoutDiskHistory(options),
  );
}

async function fallback(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const transport = new SummaryTransport();
      transport.empty = true;
      const { handler, runtime } = middleoutSetup(
        history,
        transport,
        undefined,
        { contextLimit: 100, compressionThreshold: 0.5 },
      );
      for await (const _row of history.streamRawHistory()) {
        /* settle the durable fixture membership */
      }
      await history.waitForTokenUpdates();
      history.syncTotalTokens(size);
      await history.waitForTokenUpdates();
      const raw = Array.from({ length: size }, (_, index) =>
        middleoutRow(index, 64),
      );
      const logger = new DebugLogger('test:fallback');
      const metadata = await buildCompressionMetadata(
        'oracle',
        runtime,
        history,
        async () => ({ provider: transport, runtime: runtime.providerRuntime }),
        undefined,
        undefined,
        logger,
      );
      const curated = buildCuratedHistory(logger, raw, false);
      const suffixTokens = new Map<number, number>();
      let total = 0;
      for (let index = curated.length - 1; index >= 0; index--) {
        total += await history.estimateTokensForContents([curated[index]]);
        suffixTokens.set(curated[index].metadata?.chronology?.seq ?? 0, total);
      }
      const result = await new TopDownTruncationStrategy().compress({
        ...metadata,
        history: curated,
        estimateTokens: async (rows) =>
          suffixTokens.get(rows[0]?.metadata?.chronology?.seq ?? 0) ?? 0,
      });
      if (result.kind !== 'applied')
        throw new Error('Expected independent truncation fallback');
      const expected = invalidateResponsesStatefulChain(
        annotateCompressionSpan(raw, result.newHistory).map((row) => {
          const metadata = { ...row.metadata };
          delete metadata.cacheAnchor;
          return { ...row, metadata };
        }),
      );
      let recorded: IContent | undefined;
      history.on('compressionEnded', (summary) => {
        recorded = summary;
      });
      expect(await handler.performCompression('empty-summary')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      const rows = await collectRows(history);
      expect(rows).toStrictEqual([...expected]);
      expect(recorded).toBeUndefined();
      expect(history.getCacheAnchorSeq()).toBe(0);
      return rows.length;
    },
    64,
    middleoutRow,
    undefined,
    (options) => new MiddleoutDiskHistory(options),
  );
}

describe('invoked disk middle-out retry and fallback', () => {
  it.each([512, 8192])(
    'retries the identical pinned %i-row summary request',
    async (size) => {
      expect(await retry(size)).toBe(2);
    },
    180_000,
  );
  it.each([512, 8192])(
    'uses disk truncation of the same %i-row source after empty summary',
    async (size) => {
      expect(await fallback(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});
