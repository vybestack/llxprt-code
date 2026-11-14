/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ToolRankingTree } from '@vybestack/llxprt-code-core/journal/tool-ranking-tree.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { truncateLargestToolResponses } from '../toolResultTruncator.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';
import { nativeRankingProjection } from './support/native-ranking-projection.js';
import { pendingTokenDeps } from './pending-token-native-helpers.js';

async function collectGarbage(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}
function live(values: ReadonlyArray<WeakRef<object>>): number {
  return values.filter((weak) => weak.deref() !== undefined).length;
}

describe('pending-token native conversion unit lifetime', () => {
  it.each([65])(
    'releases converted rows at actual sink backpressure at %i rows',
    async (size) => {
      await withNativeFallbackFixture(async ({ history, seed }) => {
        await seed(
          Array.from({ length: size }, (_, index) => toolRankingRow(index, 64)),
        );
        const ranks: Array<WeakRef<object>> = [];
        const rows: Array<WeakRef<IContent>> = [];
        const read = ToolRankingTree.prototype.node;
        ToolRankingTree.prototype.node = async function (
          this: ToolRankingTree,
          id,
        ) {
          const value = await read.call(this, id);
          ranks.push(new WeakRef(value));
          return value;
        };
        let samples = 0;
        let peakRanks = 0;
        let peakRows = 0;
        const sample = async (row: IContent): Promise<void> => {
          rows.push(new WeakRef(row));
          if (rows.length % 8 !== 0) return;
          await collectGarbage();
          samples++;
          peakRanks = Math.max(peakRanks, live(ranks));
          peakRows = Math.max(peakRows, live(rows));
          expect(live(ranks)).toBeLessThanOrEqual(64);
          expect(live(rows)).toBeLessThanOrEqual(2);
        };
        const transform = history.detachedValues.transform;
        history.detachedValues.transform = (producer, model, options) =>
          transform(
            async (source, sink) =>
              producer(source, {
                ...sink,
                appendDerived: async (ordinal, row) => {
                  await sink.appendDerived(ordinal, row);
                  await sample(row);
                },
              }),
            model,
            options,
          );
        try {
          const result = await truncateLargestToolResponses(
            {
              ...pendingTokenDeps(history),
              estimateBlockTokensAsync: async (block) =>
                block.type === 'tool_response' &&
                block.providerMetadata?.contextTruncated !== true
                  ? 1000
                  : 100,
              computeProjected: () =>
                nativeRankingProjection(history.streamRawHistory(), 100),
            },
            size * 1000 - 1,
          );
          expect(result).toStrictEqual({
            replacedCount: 1,
            projected: size * 1000 - 900,
            success: true,
          });
          expect(samples).toBeGreaterThanOrEqual(Math.floor(size / 8));
          await collectGarbage();
          expect(live(rows)).toBe(0);
          expect(live(ranks)).toBe(0);
          process.stdout.write(
            `PENDING_LIFETIME ${JSON.stringify({ size, samples, peakRanks, peakRows, finalRows: live(rows), finalRanks: live(ranks) })}\n`,
          );
        } finally {
          history.detachedValues.transform = transform;
          ToolRankingTree.prototype.node = read;
        }
      });
    },
    180_000,
  );
});
