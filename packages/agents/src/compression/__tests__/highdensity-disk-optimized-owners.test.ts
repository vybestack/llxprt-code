/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  densityRow,
  densityOracle,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';
import {
  highdensitySetup,
  HighdensityPreparationHistory,
} from './highdensity-disk-helpers.js';

async function bounded(size: number): Promise<number> {
  const mutation = new RowOwnership();
  await withSuffixFixture(
    size,
    async (history, source) => {
      const { handler, transport } = highdensitySetup(
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
      await handler.ensureDensityOptimized();
      expect(await digestStream(history.streamRawHistory())).toBe(
        digestRows(densityOracle(size)),
      );
      expect(await handler.performCompression('bounded-optimized')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      expect(transport.requests).toHaveLength(0);
      for (const owner of [source, mutation]) {
        expect(owner.snapshot().acquisitions).toBeGreaterThan(0);
        expect(owner.snapshot().peakRows).toBeLessThanOrEqual(440);
        expect(owner.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
          8 * 1024 * 1024,
        );
      }
      expect(source.snapshot().liveRows).toBe(0);
      expect(source.snapshot().liveSerializedBytes).toBe(0);
      expect(mutation.snapshot().liveRows).toBe(0);
      await history.waitForCommit();
      for (const owner of [source, mutation]) {
        expect(owner.snapshot().liveRows).toBe(0);
        expect(owner.snapshot().liveSerializedBytes).toBe(0);
      }
    },
    2048,
    densityRow,
    mutation,
    (options) => new HighdensityPreparationHistory(options),
  );
  expect(mutation.snapshot().liveRows).toBe(0);
  expect(mutation.snapshot().liveSerializedBytes).toBe(0);
  return mutation.snapshot().liveRows;
}

describe('combined optimizer and compressor bounded journal publication', () => {
  it.each([512, 8192])(
    'keeps actual source and transaction owners within the unchanged fixture bounds for %i rows',
    async (size) => {
      expect(await bounded(size)).toBe(0);
    },
    180_000,
  );
});
