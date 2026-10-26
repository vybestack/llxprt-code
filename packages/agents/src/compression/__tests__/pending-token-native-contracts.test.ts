/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRollbackFixture,
  durableRowsOf,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { truncateLargestToolResponses } from '../toolResultTruncator.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  freezeRows,
  lengthTokenizer,
  pendingArrayOracle,
  pendingRankRow,
  pendingTokenDeps,
  PENDING_BUDGET,
} from './pending-token-native-helpers.js';

describe('pending-token native ranking immutable policy parity', () => {
  it.each([3, 64, 65, 5000])(
    'matches the independent array and old disk output, exact tokens and durable rows at %i rows',
    async (size) => {
      await withNativeValueFixture(async ({ history, durable, owners }) => {
        await withRollbackFixture(async (old, recorder) => {
          lengthTokenizer(history);
          lengthTokenizer(old);
          const input = Array.from({ length: size }, (_, index) =>
            pendingRankRow(index, size),
          );
          freezeRows(input);
          const original = JSON.stringify(input);
          await history.detachedValues.replace(input);
          await old.detachedValues.replace(input);
          await history.waitForCommit();
          await recorder.flush();
          const limit = history.getTotalTokens() + PENDING_BUDGET - 4200.5;
          const expected = await pendingArrayOracle(input, old, limit);
          let oldResets = 0;
          const oldResult = await truncateLargestToolResponses(
            pendingTokenDeps(old, () => {
              oldResets++;
            }),
            limit,
          );
          let resets = 0;
          const oldPin = await old.openCompressionInput();
          const requestPin = await history.openCompressionInput();
          let files: Awaited<ReturnType<typeof operationFileCreates>>;
          try {
            files = await operationFileCreates(async () => {
              const result = await truncateLargestToolResponses(
                pendingTokenDeps(history, () => {
                  resets++;
                }),
                limit,
              );
              expect(result).toStrictEqual(oldResult);
              expect(result).toStrictEqual({
                replacedCount: expected.replacedCount,
                projected: expected.projected,
                success: expected.success,
              });
            }, true);
          } finally {
            await requestPin.close();
            await oldPin.close();
          }
          const actual = await Array.fromAsync(history.streamRawHistory());
          expect(expected.replacedCount).toBe(2);
          expect(actual).toStrictEqual([...expected.rows]);
          expect(await Array.fromAsync(old.streamRawHistory())).toStrictEqual([
            ...expected.rows,
          ]);
          expect(resets).toBe(2);
          expect(oldResets).toBe(2);
          expect(history.getTotalTokens()).toBe(old.getTotalTokens());
          expect(history.getContextRange()).toStrictEqual(
            old.getContextRange(),
          );
          expect(await durable()).toStrictEqual(
            await compressionValueDigest(expected.rows),
          );
          await recorder.flush();
          expect(await durableRowsOf(recorder)).toStrictEqual([
            ...expected.rows,
          ]);
          expect(files).toStrictEqual({ directories: [], files: [] });
          expect(JSON.stringify(input)).toBe(original);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expect(owners.snapshot().liveRows).toBe(0);
          process.stdout.write(
            `PENDING_PARITY ${JSON.stringify({ size, replaced: expected.replacedCount, projected: expected.projected })}\n`,
          );
        });
      });
    },
    180_000,
  );
  it('still replaces the first ranked response when projection already fits', async () => {
    await withNativeValueFixture(async ({ history }) => {
      lengthTokenizer(history);
      await history.detachedValues.replace([pendingRankRow(0, 3)]);
      const limit = history.getTotalTokens() + PENDING_BUDGET + 1;
      expect(
        await truncateLargestToolResponses(pendingTokenDeps(history), limit),
      ).toMatchObject({ replacedCount: 1, success: true });
    });
  });
});
