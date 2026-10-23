/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { rejectedValue, rowsOf } from './chronology-rollback-test-helpers.js';

async function expectMembership(
  history: Parameters<typeof rowsOf>[0],
  seqs: readonly number[],
): Promise<void> {
  expect(history.length()).toBe(seqs.length);
  expect(
    (await rowsOf(history)).map((row) => row.metadata?.chronology?.seq),
  ).toStrictEqual([...seqs]);
}

describe('scalar cardinality across journal operations', () => {
  it('matches marker membership through density, cuts, replacement and clear', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      await history.addBatch(
        Array.from({ length: 4 }, (_, index) => batchRow(index)),
      );
      await expectMembership(history, [1, 2, 3, 4]);
      await history.applyDensityResult({
        removals: [1, 2],
        replacements: new Map([[3, batchRow(10)]]),
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 2,
        },
      });
      await expectMembership(history, [1, 4]);
      await history.pop();
      await expectMembership(history, [1]);
      await history.replaceBatch([batchRow(11)]);
      await expectMembership(history, [12]);
      await history.addBatch([batchRow(12)]);
      await expectMembership(history, [12, 13]);
      await history.waitForCommit();
      await expectMembership(history, [12, 13]);
      await history.clear();
      await expectMembership(history, []);
      await history.waitForCommit();
      await expectMembership(history, []);
      expect(history.isEmpty()).toBe(true);
    });
  });

  it('keeps count and releases decoded owners after an aborted cursor', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      await history.addBatch([batchRow(0)]);
      const cancellation = new Error('cancel scalar cursor');
      const controller = new AbortController();
      controller.abort(cancellation);
      const operation = (async (): Promise<void> => {
        for await (const row of history.streamRawHistory(controller.signal))
          expect(row).toStrictEqual(batchRow(0));
      })();
      expect(await rejectedValue(operation)).toBe(cancellation);
      await expectMembership(history, [1]);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('restores the previous count and values after checkpoint rollback', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      await history.addBatch([batchRow(0)]);
      await history.detachedValues.withRollbackCheckpoint(async (restore) => {
        await history.replaceBatch([batchRow(5), batchRow(6)]);
        await expectMembership(history, [6, 7]);
        await history.waitForCommit();
        await restore();
        await expectMembership(history, [1]);
      });
      await history.waitForCommit();
      await expectMembership(history, [1]);
      expect(history.length()).toBe(1);
    });
  });
});
