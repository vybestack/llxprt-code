/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { optimizeDiskDensity } from '../diskDensityOptimization.js';
import {
  densityConfig,
  densityRow,
  densityHandler,
  digestStream,
  digestRows,
  densityOracle,
} from './density-disk-helpers.js';

describe('density candidate source ownership', () => {
  it('charges the actual decoded original throughout each addressed decision', async () => {
    const ownership = new RowOwnership();
    await withSuffixFixture(
      512,
      async (history) => {
        densityHandler(history);
        let minimum = Number.POSITIVE_INFINITY;
        let decisions = 0;
        await history.optimizeDensityRows((source) => {
          const result = optimizeDiskDensity(source, densityConfig());
          return {
            metadata: result.metadata,
            removalCount: result.removalCount,
            replacementCount: result.replacementCount,
            decision(index) {
              if (decisions++ < source.length)
                minimum = Math.min(minimum, ownership.snapshot().liveRows);
              return result.decision(index);
            },
            close: () => result.close(),
          };
        });
        expect(minimum).toBeGreaterThan(0);
        expect(await digestStream(history.streamRawHistory())).toBe(
          digestRows(densityOracle(512)),
        );
        expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(440);
        expect(ownership.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
          8 * 1024 * 1024,
        );
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      2048,
      densityRow,
      ownership,
    );
  });
});
