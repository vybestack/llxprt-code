/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  highdensitySetup,
  highdensityRow,
  HighdensityPreparationHistory,
} from './highdensity-disk-helpers.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { collectRows } from './truncation-stream-helpers.js';

async function ratio(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const { runtime: seed, transport } = highdensitySetup(history);
      const runtime = createAgentRuntimeContext({
        state: seed.state,
        history,
        provider: seed.provider,
        telemetry: seed.telemetry,
        tools: seed.tools,
        providerRuntime: seed.providerRuntime,
        settings: {
          compressionStrategy: 'high-density',
          contextLimit: 300000,
          compressionThreshold: 0.95,
          preserveThreshold: 0.9,
          'compression.density.compressHeadroom': 0.99,
        },
      });
      const resolveProvider = async (): Promise<{
        provider: typeof transport;
        runtime: typeof runtime.providerRuntime;
      }> => ({ provider: transport, runtime: runtime.providerRuntime });
      const logger = new DebugLogger('test:highdensity-ratio');
      const metadata = await buildCompressionMetadata(
        'oracle',
        runtime,
        history,
        resolveProvider,
        undefined,
        undefined,
        logger,
      );
      const raw = Array.from({ length: size }, (_, index) =>
        highdensityRow(index, 64),
      );
      const legacy = await new HighDensityStrategy().compress({
        ...metadata,
        history: buildCuratedHistory(logger, raw, false),
      });
      if (legacy.kind !== 'applied')
        throw new Error('Expected applied high-ratio oracle');
      const expected = invalidateResponsesStatefulChain(
        annotateCompressionSpan(raw, legacy.newHistory).map((row) => {
          const metadata = { ...row.metadata };
          delete metadata.cacheAnchor;
          return { ...row, metadata };
        }),
      );
      const handler = new CompressionHandler(
        runtime,
        history,
        {},
        resolveProvider,
        async () => {},
      );
      expect(await handler.performCompression('high-ratio')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      const actual = await collectRows(history);
      expect(actual).toStrictEqual([...expected]);
      expect(actual.length).toBeGreaterThanOrEqual(
        Math.floor(buildCuratedHistory(logger, raw, false).length * 0.9),
      );
      expect(await history.estimateTokensForContents(actual)).toBe(
        await history.estimateTokensForContents(expected),
      );
      expect(transport.requests).toHaveLength(0);
      return actual.length;
    },
    64,
    highdensityRow,
    undefined,
    (options) => new HighdensityPreparationHistory(options),
  );
}

describe('high-density disk high preservation and headroom ratios', () => {
  it.each([512, 8192])(
    'matches the legacy %i-row boundary and token decisions at 90-percent preservation and 99-percent headroom',
    async (size) => {
      expect(await ratio(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});
