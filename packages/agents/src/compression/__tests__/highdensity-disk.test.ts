/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  highdensitySetup,
  highdensityOracle,
  highdensityRow,
  HighdensityPreparationHistory,
} from './highdensity-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';

async function parity(size: number, limit: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const expected = await highdensityOracle(
        history,
        size,
        2048,
        highdensityRow,
        { contextLimit: limit },
      );
      const { handler, transport } = highdensitySetup(
        history,
        undefined,
        undefined,
        { contextLimit: limit },
      );
      history.setCacheAnchorSeq(2);
      expect(await handler.performCompression('disk')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      const rows = await collectRows(history);
      expect(rows).toStrictEqual([...expected]);
      expect(await history.estimateTokensForContents(rows)).toBe(
        await history.estimateTokensForContents(expected),
      );
      expect(history.getCacheAnchorSeq()).toBe(0);
      expect(transport.requests).toHaveLength(0);
      return rows.length;
    },
    2048,
    highdensityRow,
    undefined,
    (options) => new HighdensityPreparationHistory(options),
  );
}

describe('invoked pinned disk high-density compression', () => {
  it.each([
    [512, 30000],
    [8192, 30000],
    [512, 1e9],
    [8192, 1e9],
  ])(
    'matches independent tool summaries and truncation for %i rows at limit %i',
    async (size, limit) => {
      expect(await parity(size, limit)).toBeGreaterThan(0);
    },
    180_000,
  );
  it('leaves an empty history unchanged without eager preparation', async () => {
    const history = new HighdensityPreparationHistory();
    try {
      const { handler, transport } = highdensitySetup(history);
      expect(await handler.performCompression('empty')).toBe(
        PerformCompressionResult.SKIPPED_EMPTY,
      );
      expect(await collectRows(history)).toHaveLength(0);
      expect(transport.requests).toHaveLength(0);
    } finally {
      history.dispose();
    }
  });
});
