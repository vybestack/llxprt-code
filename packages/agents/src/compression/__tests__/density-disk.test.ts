/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import {
  densityHandler,
  densityOracle,
  densityRow,
  DensityDiskHistory,
  digestRows,
  digestStream,
} from './density-disk-helpers.js';

describe('invoked pinned disk density optimization', () => {
  for (const size of [512, 8192]) {
    for (const mask of [0, 1, 2, 4, 7]) {
      it(`preserves legacy ${size}-row selected transformations for phase mask ${mask}`, async () => {
        const ownership = new RowOwnership();
        await withSuffixFixture(
          size,
          async (history, reader) => {
            const expected = densityOracle(size, mask);
            const handler = densityHandler(history, mask);
            await handler.ensureDensityOptimized();
            expect(await digestStream(history.streamRawHistory())).toBe(
              digestRows(expected),
            );
            expect(handler.densityDirty).toBe(false);
            expect(reader.snapshot().peakRows).toBeLessThanOrEqual(440);
            expect(reader.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
              8 * 1024 * 1024,
            );
            expect(ownership.snapshot().peakRows).toBeLessThanOrEqual(440);
            expect(
              ownership.snapshot().peakSerializedBytes,
            ).toBeLessThanOrEqual(8 * 1024 * 1024);
            expect(ownership.snapshot().liveRows).toBe(0);
            expect(ownership.snapshot().liveSerializedBytes).toBe(0);
          },
          2048,
          densityRow,
          ownership,
          (options) => new DensityDiskHistory(options),
        );
      }, 180_000);
    }
  }
});
