/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  batchGate,
  batchRow,
} from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  durableRowsOf,
  expectedRange,
  rejectedValue,
  rowsOf,
} from './chronology-rollback-test-helpers.js';

async function expectMembership(
  fixture: Parameters<Parameters<typeof withNativeDetachedFixture>[0]>[0],
  count: number,
): Promise<void> {
  const { history, recording } = fixture;
  const rows = await rowsOf(history);
  expect(rows).toHaveLength(count);
  expect(history.length()).toBe(count);
  expect(history.isEmpty()).toBe(count === 0);
  expect(history.getTotalTokens()).toBe(count * 4);
  expect(history.getContextRange()).toStrictEqual(expectedRange(count));
  await history.waitForCommit();
  expect(await durableRowsOf(recording)).toStrictEqual(rows);
}

describe('scalar length follows atomic journal replacement membership', () => {
  it('keeps the prior length while the replacement writer is held and publishes the complete count after acknowledgement', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const { history } = fixture;
      await history.addBatch([batchRow(0), batchRow(1)]);
      fixture.pauseWriter();
      const replacement = history.replaceBatch([
        batchRow(2),
        batchRow(3),
        batchRow(4),
      ]);
      try {
        await fixture.writerPaused;
        expect(history.length()).toBe(2);
        expect(history.getTotalTokens()).toBe(8);
        fixture.releaseWriter();
        await replacement;
        expect(history.length()).toBe(3);
        expect((await rowsOf(history)).map((row) => row.blocks)).toStrictEqual([
          batchRow(2).blocks,
          batchRow(3).blocks,
          batchRow(4).blocks,
        ]);
      } finally {
        fixture.releaseWriter();
        await replacement;
      }
    });
  });

  for (const stage of ['records', 'trailer'] satisfies Array<
    'records' | 'trailer'
  >) {
    it(`keeps length, tokens, range, chronology and persisted membership after ${stage} failure`, async () => {
      await withNativeDetachedFixture(async (fixture) => {
        await fixture.history.addBatch([batchRow(0), batchRow(1)]);
        const before = await rowsOf(fixture.history);
        const failure = new Error(`replacement ${stage} failed`);
        fixture.io.rejectNextWrite(failure, stage);
        expect(
          await rejectedValue(
            fixture.history.replaceBatch([
              batchRow(2),
              batchRow(3),
              batchRow(4),
            ]),
          ),
        ).toBe(failure);
        await expectMembership(fixture, 2);
        expect(await rowsOf(fixture.history)).toStrictEqual(before);
      });
    });
  }

  it('commits an empty replacement and restores it after a rejected observer', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const { history } = fixture;
      await history.addBatch([batchRow(0), batchRow(1)]);
      const ready = batchGate();
      const release = batchGate();
      const failure = new Error('empty replacement rejected');
      const operation = rejectedValue(
        history.replaceBatch([], undefined, {
          afterPublication: async () => {
            ready.resolve();
            await release.promise;
            throw failure;
          },
        }),
      );
      try {
        await ready.promise;
        expect(history.length()).toBe(0);
        release.resolve();
        expect(await operation).toBe(failure);
        await expectMembership(fixture, 2);
        await history.replaceBatch([]);
        expect(history.length()).toBe(0);
        expect(history.isEmpty()).toBe(true);
        expect(await rowsOf(history)).toStrictEqual([]);
        await history.waitForCommit();
        expect(await durableRowsOf(fixture.recording)).toStrictEqual([]);
      } finally {
        release.resolve();
        await operation;
      }
    });
  });
});
