/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { readdirSync } from 'node:fs';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withToolResponseRanking } from '../toolResponseDiskRanking.js';
import {
  BoundedToolHistory,
  toolRankingRow,
  toolScore,
} from './tool-truncation-stream-helpers.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

function roots(): string[] {
  return readdirSync(getScratchRoot())
    .filter((name) => name.startsWith('tool-response-ranking-'))
    .sort();
}
describe('pinned ranking source and returned consumers', () => {
  it.each([512, 8192])(
    'keeps %i-row rank membership pinned across clear and releases early-return consumer copies',
    async (size) => {
      const before = roots();
      await withSuffixFixture(
        size,
        async (history, ownership) => {
          history.setTokenizerFactory(exactTokenizer());
          let cleared = false;
          const consumer = new RowOwnership();
          const selected = await withToolResponseRanking(
            history,
            [],
            async (block) => {
              if (!cleared) {
                cleared = true;
                history.clear();
              }
              return toolScore(block);
            },
            async (ranked, unchanged) => {
              const cursor = ranked[Symbol.iterator]();
              const first = cursor.next();
              if (first.done === true)
                throw new Error('Missing pinned candidate');
              const copy = { ...first.value.block };
              consumer.retain(first.value.block);
              consumer.retain(copy);
              try {
                cursor.return();
                return {
                  count: ranked.historyLength,
                  entry: first.value.entryIndex,
                  unchanged: await unchanged(),
                };
              } finally {
                consumer.release(copy);
                consumer.release(first.value.block);
              }
            },
          );
          expect(selected).toStrictEqual({
            count: size,
            entry: size - 1,
            unchanged: false,
          });
          expect(consumer.snapshot().peakRows).toBe(2);
          expect([
            consumer.snapshot().liveRows,
            ownership.snapshot().liveRows,
          ]).toStrictEqual([0, 0]);
        },
        2048,
        toolRankingRow,
        undefined,
        (options) => new BoundedToolHistory(options),
      );
      const after = roots();
      expect({
        added: after.filter((name) => !before.includes(name)).length,
        removed: before.filter((name) => !after.includes(name)).length,
      }).toStrictEqual({ added: 0, removed: 0 });
    },
    120000,
  );
});

describe('ranking consumer failures', () => {
  it('closes the disk index when its returned consumer throws', async () => {
    const before = roots();
    await withSuffixFixture(
      512,
      async (history, ownership) => {
        await expect(
          withToolResponseRanking(history, [], toolScore, async (ranked) => {
            for (const candidate of ranked) {
              void candidate;
              throw new Error('consumer failed');
            }
          }),
        ).rejects.toThrow('consumer failed');
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      2048,
      toolRankingRow,
    );
    const after = roots();
    expect({
      added: after.filter((name) => !before.includes(name)).length,
      removed: before.filter((name) => !after.includes(name)).length,
    }).toStrictEqual({ added: 0, removed: 0 });
  });
});
