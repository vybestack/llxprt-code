/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchGate, batchRow } from './addbatch-stream-test-helpers.js';
import {
  durableRowsOf,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

async function retryAfterFailure(
  size: number,
  observer: boolean,
): Promise<void> {
  await withRollbackFixture(async (history, recorder) => {
    await history.addBatch([batchRow(20000)]);
    await history.waitForCommit();
    const batch = Array.from({ length: size }, (_, index) => batchRow(index));
    const ready = batchGate();
    const release = batchGate();
    const failure = new Error('observer rollback');
    if (!observer) recorder.failAdmissionAfter(7);
    const operation = history.addBatch(batch, undefined, {
      streamPublication: true,
      afterPublication: async () => {
        if (!observer) return;
        ready.resolve();
        await release.promise;
        throw failure;
      },
    });
    if (observer) await ready.promise;
    const queued = rollbackRow(90000);
    history.add(queued);
    release.resolve();
    expect(await rejectedValue(operation)).toBe(
      observer ? failure : recorder.failure,
    );
    await history.waitForTokenUpdates();
    expect(history.getTotalTokens()).toBe(8);
    const prior = await rowsOf(history);
    expect(prior).toHaveLength(2);
    expect(prior[0]).toStrictEqual(batchRow(20000));
    expect(prior[1]).toStrictEqual(queued);
    expect(queued.metadata?.chronology?.seq).toBe(20002);
    await history.waitForCommit();
    expect(await durableRowsOf(recorder)).toStrictEqual(prior);
    await history.addBatch(batch, undefined, { streamPublication: true });
    expect(history.getTotalTokens()).toBe(8 + 4 * size);
    const retried = await rowsOf(history);
    expect(retried).toStrictEqual([...prior, ...batch]);
    await history.waitForCommit();
    expect(await durableRowsOf(recorder)).toStrictEqual(retried);
  });
}

describe('addBatch streamed atomicity', () => {
  it('rolls back a failed batch listener while the caller writer is paused and persists correct values after release', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const batch = [rollbackRow(0), rollbackRow(1)];
      const failure = new Error('pending batch listener');
      history.once('contentBatchAdded', () => {
        throw failure;
      });
      const failed = rejectedValue(history.addBatch(batch));
      releaseWriter();
      expect(await failed).toBe(failure);
      expect(await rowsOf(history)).toStrictEqual([]);
      expect(batch.map((row) => row.metadata)).toStrictEqual([
        undefined,
        undefined,
      ]);
      expect(history.getTotalTokens()).toBe(0);
      await history.addBatch(batch);
      const published = await rowsOf(history);
      expect(published.map((row) => row.blocks)).toStrictEqual(
        batch.map((row) => row.blocks),
      );
      expect(
        published.map((row) => row.metadata?.chronology?.seq),
      ).toStrictEqual([1, 2]);
      await history.waitForCommit();
      expect(await durableRowsOf(recorder)).toStrictEqual(published);
    }, true);
  });
  it.each([512, 8192])(
    'compensates partial admission of %i mixed rows before a queued add and retries',
    async (size) => {
      await expect(retryAfterFailure(size, false)).resolves.toBeUndefined();
    },
    180000,
  );
  it.each([512, 8192])(
    'compensates observer rejection of %i mixed rows before a queued add and retries',
    async (size) => {
      await expect(retryAfterFailure(size, true)).resolves.toBeUndefined();
    },
    180000,
  );
});
