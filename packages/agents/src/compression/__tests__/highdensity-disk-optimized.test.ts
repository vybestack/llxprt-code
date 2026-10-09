/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { densityRow, densityOracle } from './density-disk-helpers.js';
import {
  highdensitySetup,
  HighdensityPreparationHistory,
} from './highdensity-disk-helpers.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { collectRows } from './truncation-stream-helpers.js';

async function optimized(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const { handler, runtime, transport } = highdensitySetup(
        history,
        undefined,
        undefined,
        {
          'compression.density.optimizeThreshold': 0,
          'compression.density.readWritePruning': true,
          'compression.density.fileDedupe': true,
          'compression.density.recencyPruning': true,
          'compression.density.recencyRetention': 3,
        },
      );
      const source = densityOracle(size);
      await handler.ensureDensityOptimized();
      expect(await collectRows(history)).toStrictEqual(source);
      const logger = new DebugLogger('test:optimized-highdensity');
      const metadata = await buildCompressionMetadata(
        'oracle',
        runtime,
        history,
        async () => ({ provider: transport, runtime: runtime.providerRuntime }),
        undefined,
        undefined,
        logger,
      );
      const legacy = await new HighDensityStrategy().compress({
        ...metadata,
        history: buildCuratedHistory(logger, source, false),
      });
      if (legacy.kind !== 'applied')
        throw new Error('Expected applied optimized-history oracle');
      const expected = invalidateResponsesStatefulChain(
        annotateCompressionSpan(source, legacy.newHistory).map((row) => {
          const metadata = { ...row.metadata };
          delete metadata.cacheAnchor;
          return { ...row, metadata };
        }),
      );
      expect(await handler.performCompression('optimized')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      const actual = await collectRows(history);
      expect(actual).toStrictEqual([...expected]);
      expect(await history.estimateTokensForContents(actual)).toBe(
        await history.estimateTokensForContents(expected),
      );
      expect(transport.requests).toHaveLength(0);
      return actual.length;
    },
    2048,
    densityRow,
    undefined,
    (options) => new HighdensityPreparationHistory(options),
  );
}

describe('continuous density decisions followed by primary disk high-density compression', () => {
  it.each([512, 8192])(
    'matches independent legacy optimization and compression for %i mixed rows with addressed density indexes',
    async (size) => {
      expect(await optimized(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});
