/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import {
  MergeRowHistory,
  mergeRow,
  oracleDigest,
  streamDigest,
} from './history-merge-test-helpers.js';

describe('transactional history merge rows', () => {
  for (const size of [512, 8192]) {
    it(`appends ${size} mixed rows without eager reads and preserves complete source values`, async () => {
      const owners = new RowOwnership();
      await withSuffixFixture(
        size,
        async (source) => {
          await withSuffixFixture(
            1,
            async (target) => {
              target.setTokenizerFactory(exactTokenizer());
              await target.merge(source);
              expect(target.getTotalTokens()).toBe(size * 4);
              await target.waitForCommit();
              expect(await streamDigest(target.streamRawHistory())).toBe(
                oracleDigest(size, 1, true),
              );
              expect(await streamDigest(source.streamRawHistory())).toBe(
                oracleDigest(size),
              );
              expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
              expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
                8 * 1024 * 1024,
              );
              expect(owners.snapshot().liveRows).toBe(0);
            },
            0,
            () => mergeRow(20000),
            owners,
            (options) => new MergeRowHistory(options),
          );
        },
        2048,
        mergeRow,
        owners,
        (options) => new MergeRowHistory(options),
      );
    }, 600_000);
  }
});

describe('history merge self append and large row', () => {
  it('pins self-merge once and preserves markers when the appended rows are duplicated', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        history.setTokenizerFactory(exactTokenizer());
        await history.merge(history);
        await history.waitForCommit();
        expect(await streamDigest(history.streamRawHistory())).toBe(
          oracleDigest(3, 2),
        );
      },
      2048,
      mergeRow,
      undefined,
      (options) => new MergeRowHistory(options),
    );
  });

  it('accepts a valid nine MiB row without applying the controlled-fixture byte limit as an input cap', async () => {
    const bytes = 9 * 1024 * 1024;
    await withSuffixFixture(
      1,
      async (source) => {
        await withSuffixFixture(
          0,
          async (target) => {
            target.setTokenizerFactory(exactTokenizer());
            await target.merge(source);
            let count = 0;
            for await (const row of target.streamRawHistory()) {
              expect(row).toStrictEqual(mergeRow(0, bytes));
              count++;
            }
            expect(count).toBe(1);
          },
          0,
          mergeRow,
          undefined,
          (options) => new MergeRowHistory(options),
        );
      },
      bytes,
      mergeRow,
      undefined,
      (options) => new MergeRowHistory(options),
    );
  }, 120_000);
});
