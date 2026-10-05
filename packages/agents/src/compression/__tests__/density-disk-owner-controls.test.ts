/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DiskDensityOptimizer } from '@vybestack/llxprt-code-core/services/history/historyDiskDensity.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withSuffixFixture } from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import { densityHandler, densityRow } from './density-disk-helpers.js';

class RetainingDensityHistory extends HistoryService {
  readonly retainingOwner = new RowOwnership();
  copy = false;
  override async optimizeDensityRows(
    optimize: DiskDensityOptimizer,
  ): Promise<void> {
    const held: IContent[] = [];
    try {
      await super.optimizeDensityRows((source) => {
        for (const row of source) {
          const retained = this.copy
            ? { ...row, blocks: [...row.blocks] }
            : row;
          held.push(retained);
          this.retainingOwner.retain(retained);
        }
        return optimize(source);
      });
    } finally {
      for (const row of held) this.retainingOwner.release(row);
      held.length = 0;
    }
  }
}

async function observeControl(
  size: number,
  copy: boolean,
): Promise<ReturnType<RowOwnership['snapshot']>> {
  let result: ReturnType<RowOwnership['snapshot']> | undefined;
  await withSuffixFixture(
    size,
    async (history) => {
      if (!(history instanceof RetainingDensityHistory))
        throw new Error('Wrong retaining fixture');
      history.copy = copy;
      await densityHandler(history).ensureDensityOptimized();
      result = history.retainingOwner.snapshot();
    },
    2048,
    densityRow,
    undefined,
    (options) => new RetainingDensityHistory(options),
  );
  if (result === undefined) throw new Error('No density retaining measurement');
  return result;
}

function assertBounded(
  stats: ReturnType<RowOwnership['snapshot']>,
  _size: number,
): void {
  expect(stats.peakRows).toBeLessThanOrEqual(440);
  expect(stats.peakSerializedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
}

function assertRetained(
  stats: ReturnType<RowOwnership['snapshot']>,
  size: number,
): void {
  expect(stats.peakRows).toBe(size);
  expect(stats.peakRows).toBeGreaterThan(440);
  if (size === 8192)
    expect(stats.peakSerializedBytes).toBeGreaterThan(8 * 1024 * 1024);
}

const check =
  process.env.DENSITY_RETAINING_TRAP === '1' ? assertBounded : assertRetained;

describe('density borrowed and distinct-copy retaining controls', () => {
  for (const size of [512, 8192])
    for (const copy of [false, true]) {
      it(`detects ${size} retained ${copy ? 'copied' : 'borrowed'} source rows using unchanged fixture bounds`, async () => {
        const stats = await observeControl(size, copy);
        check(stats, size);
        expect(stats.liveRows).toBe(0);
        expect(stats.liveSerializedBytes).toBe(0);
      }, 600_000);
    }
});
