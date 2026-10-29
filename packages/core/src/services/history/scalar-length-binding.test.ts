/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { rowsOf } from './chronology-rollback-test-helpers.js';

async function* values(
  count: number,
): AsyncGenerator<ReturnType<typeof batchRow>, void, unknown> {
  for (let index = 0; index < count; index++) yield batchRow(index);
}

describe('scalar count across journal binding boundaries', () => {
  it('keeps all 512 rows through recorder detach and reattach without counting mirror rows twice', async () => {
    await withNativeDetachedFixture(async ({ history, recording, owners }) => {
      await history.detachedValues.replace(values(512));
      expect(history.length()).toBe(512);
      await history.detachJournal(recording);
      expect(history.length()).toBe(512);
      await history.attachJournal(recording, true);
      await history.addBatch([batchRow(512)]);
      expect(history.length()).toBe(513);
      await history.waitForCommit();
      expect(await rowsOf(history)).toStrictEqual(
        Array.from({ length: 513 }, (_, index) => batchRow(index)),
      );
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('truncates by count without reacquiring previously submitted rows', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      await history.detachedValues.replace(values(512));
      await history.pop();
      expect(history.length()).toBe(511);
      await history.waitForCommit();
      expect(await rowsOf(history)).toStrictEqual(
        Array.from({ length: 511 }, (_, index) => batchRow(index)),
      );
      const before = owners.snapshot().acquisitions;
      for (let index = 0; index < 512; index++)
        expect(history.length()).toBe(511);
      expect(owners.snapshot().acquisitions).toBe(before);
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
    });
  });

  it('keeps replacement-only density cardinality at 512', async () => {
    await withNativeDetachedFixture(async ({ history, owners }) => {
      await history.detachedValues.replace(values(512));
      await history.applyDensityResult({
        removals: [],
        replacements: new Map([[255, batchRow(600)]]),
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 0,
          recencyPruned: 0,
        },
      });
      expect(history.length()).toBe(512);
      await history.waitForCommit();
      expect(await rowsOf(history)).toHaveLength(512);
      expect((await rowsOf(history))[255].blocks).toStrictEqual(
        batchRow(600).blocks,
      );
      expect(owners.snapshot().liveRows).toBe(0);
      expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
    });
  });
});
