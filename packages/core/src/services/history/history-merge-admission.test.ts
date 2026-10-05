/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import { exactTokenizer, rowsOf } from './chronology-rollback-test-helpers.js';
import { mergeRow, MergeRowHistory } from './history-merge-test-helpers.js';

function admissionRow(index: number): IContent {
  return index === 1 ? { speaker: 'ai', blocks: [] } : mergeRow(index);
}

describe('history merge accepted source rows', () => {
  it('matches independent array addAll admission, skipping zero-block source rows', async () => {
    await withSuffixFixture(
      3,
      async (source) => {
        await withSuffixFixture(
          0,
          async (target) => {
            const oracle = new HistoryService();
            oracle.setTokenizerFactory(exactTokenizer());
            target.setTokenizerFactory(exactTokenizer());
            try {
              oracle.addAll(
                Array.from({ length: 3 }, (_unused, index) =>
                  admissionRow(index),
                ),
              );
              await oracle.waitForTokenUpdates();
              await target.merge(source);
              expect(await rowsOf(target)).toStrictEqual(await rowsOf(oracle));
              expect(target.getTotalTokens()).toBe(oracle.getTotalTokens());
            } finally {
              oracle.dispose();
            }
          },
          0,
          mergeRow,
          undefined,
          (options) => new MergeRowHistory(options),
        );
      },
      0,
      admissionRow,
      undefined,
      (options) => new MergeRowHistory(options),
    );
  });

  it('does not publish or change tokens when no source row is accepted', async () => {
    await withSuffixFixture(
      1,
      async (source) => {
        await withSuffixFixture(
          1,
          async (target) => {
            let changes = 0;
            target.on('tokensUpdated', () => changes++);
            target.on('contextRangeChanged', () => changes++);
            await target.merge(source);
            expect(changes).toBe(0);
            expect(await rowsOf(target)).toStrictEqual([mergeRow(0)]);
          },
          2048,
          mergeRow,
          undefined,
          (options) => new MergeRowHistory(options),
        );
      },
      0,
      () => ({ speaker: 'human', blocks: [] }),
    );
  });
});
