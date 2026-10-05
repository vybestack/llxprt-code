/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { CompressionExecutionError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  highdensitySetup,
  highdensityOracle,
  highdensityRow,
} from './highdensity-disk-helpers.js';
import { HighdensityFaultHistory } from './highdensity-disk-fault-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';

async function retry(size: number): Promise<number> {
  let created: HighdensityFaultHistory | undefined;
  return withSuffixFixture(
    size,
    async (history) => {
      if (created === undefined) throw new Error('Missing fault history');
      const expected = await highdensityOracle(history, size, 64);
      const { handler } = highdensitySetup(history);
      for (const error of [
        new Error('estimation denied'),
        new DOMException('cancelled estimate', 'AbortError'),
      ]) {
        created.estimateFault = () => error;
        await expect(handler.performCompression('failure')).rejects.toThrow(
          error.message,
        );
        expect(await collectRows(history)).toStrictEqual(
          Array.from({ length: size }, (_, index) => highdensityRow(index, 64)),
        );
      }
      let failures = 1;
      created.estimateFault = () =>
        failures-- > 0
          ? new CompressionExecutionError(
              'high-density',
              '503 temporary estimate failure',
              { isTransient: true },
            )
          : undefined;
      expect(await handler.performCompression('retry')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      expect(await collectRows(history)).toStrictEqual([...expected]);
      expect(failures).toBeLessThan(0);
      return failures;
    },
    64,
    highdensityRow,
    undefined,
    (options) => {
      created = new HighdensityFaultHistory(options);
      return created;
    },
  );
}

async function fallback(size: number): Promise<number> {
  let created: HighdensityFaultHistory | undefined;
  return withSuffixFixture(
    size,
    async (history) => {
      if (created === undefined) throw new Error('Missing fault history');
      const { handler, runtime, transport } = highdensitySetup(
        history,
        undefined,
        undefined,
        { contextLimit: 1000 },
      );
      await history.recalculateTotalTokens();
      const logger = new DebugLogger('test:highdensity-fallback-oracle');
      const raw = Array.from({ length: size }, (_, index) =>
        highdensityRow(index, 64),
      );
      const metadata = await buildCompressionMetadata(
        'oracle',
        runtime,
        history,
        async () => ({ provider: transport, runtime: runtime.providerRuntime }),
        undefined,
        undefined,
        logger,
      );
      const expected = await new TopDownTruncationStrategy().compress({
        ...metadata,
        history: buildCuratedHistory(logger, raw, false),
      });
      if (expected.kind !== 'applied')
        throw new Error('Expected fallback oracle application');
      const rows = invalidateResponsesStatefulChain(
        annotateCompressionSpan(raw, expected.newHistory).map((row) => {
          const metadata = { ...row.metadata };
          delete metadata.cacheAnchor;
          return { ...row, metadata };
        }),
      );
      let failures = 3;
      created.estimateFault = () =>
        failures-- > 0
          ? new CompressionExecutionError(
              'high-density',
              '503 exhausted estimate failure',
              { isTransient: true },
            )
          : undefined;
      expect(await handler.performCompression('fallback')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      expect(await collectRows(history)).toStrictEqual([...rows]);
      expect(handler.wasRecentlyCompressed()).toBe(true);
      return rows.length;
    },
    64,
    highdensityRow,
    undefined,
    (options) => {
      created = new HighdensityFaultHistory(options);
      return created;
    },
  );
}

describe('disk high-density estimate failures', () => {
  it.each([512, 8192])(
    'keeps %i pinned rows on permanent failure and abort, then retries transient estimation',
    async (size) => {
      expect(await retry(size)).toBeLessThan(0);
    },
    180_000,
  );
  it.each([512, 8192])(
    'uses disk top-down fallback over the same %i-row source after transient exhaustion',
    async (size) => {
      expect(await fallback(size)).toBeGreaterThan(0);
    },
    180_000,
  );
});
