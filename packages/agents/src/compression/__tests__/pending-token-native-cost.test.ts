/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { ToolRankingTree } from '@vybestack/llxprt-code-core/journal/tool-ranking-tree.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { truncateLargestToolResponses } from '../toolResultTruncator.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import {
  lengthTokenizer,
  pendingArrayOracle,
  pendingRankRow,
  pendingTokenDeps,
  PENDING_BUDGET,
} from './pending-token-native-helpers.js';

describe('pending-token native publication ranking cost', () => {
  it.each([65, 512])(
    'does not look up unselected prefix responses across two rounds at %i rows',
    async (size) => {
      await withNativeValueFixture(async ({ history }) => {
        lengthTokenizer(history);
        const input = Array.from(
          { length: size },
          (_, index): IContent => pendingRankRow(index, size),
        );
        await history.detachedValues.replace(input);
        const limit = history.getTotalTokens() + PENDING_BUDGET - 4200.5;
        const expected = await pendingArrayOracle(input, history, limit);
        let lookups = 0;
        const position = ToolRankingTree.prototype.position;
        const probe = spyOn(
          ToolRankingTree.prototype,
          'position',
        ).mockImplementation(function (this: ToolRankingTree, ...args) {
          lookups++;
          return position.call(this, ...args);
        });
        try {
          expect(
            await truncateLargestToolResponses(
              pendingTokenDeps(history),
              limit,
            ),
          ).toStrictEqual({
            replacedCount: expected.replacedCount,
            projected: expected.projected,
            success: expected.success,
          });
          expect(
            await Array.fromAsync(history.streamRawHistory()),
          ).toStrictEqual([...expected.rows]);
          expect(expected.replacedCount).toBe(2);
          expect(lookups).toBeLessThanOrEqual(3);
        } finally {
          probe.mockRestore();
        }
      });
    },
    180_000,
  );
});
