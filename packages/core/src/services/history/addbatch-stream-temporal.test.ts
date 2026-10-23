/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { rejectedValue, rowsOf } from './chronology-rollback-test-helpers.js';
import { detachedDigest } from './detached-rollback-test-helpers.js';

describe('journal batch publication timing', () => {
  it.each([false, true])(
    'publishes only after the whole journal group commits with explicit durability=%s',
    async (awaitDurableCommit) => {
      await withNativeDetachedFixture(async (fixture) => {
        const { history, owners } = fixture;
        await history.addBatch([batchRow(0)]);
        fixture.pauseWriter();
        let published = false;
        let acknowledged = false;
        const operation = history.detachedValues.append(
          [batchRow(1)],
          undefined,
          {
            streamPublication: true,
            awaitDurableCommit,
            afterPublication: () => {
              published = true;
            },
            onAcknowledged: () => {
              acknowledged = true;
            },
          },
        );
        await fixture.writerPaused;
        expect(published).toBe(false);
        expect(acknowledged).toBe(false);
        expect((await detachedDigest(fixture.primaryRows())).count).toBe(1);
        fixture.releaseWriter();
        await operation;
        expect(published).toBe(true);
        expect(acknowledged).toBe(true);
        expect(await rowsOf(history)).toStrictEqual([batchRow(0), batchRow(1)]);
        expect((await fixture.durable()).count).toBe(2);
        expect(history.getTotalTokens()).toBe(8);
        expect(owners.snapshot().liveRows).toBe(0);
      });
    },
  );

  it('compensates a publication callback rejection after releasing the primary writer', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const { history, owners } = fixture;
      await history.addBatch([batchRow(0)]);
      fixture.pauseWriter();
      const failure = new Error('publication callback');
      const operation = history.addBatch([batchRow(1)], undefined, {
        afterPublication: () => {
          throw failure;
        },
      });
      const rejected = rejectedValue(operation);
      await fixture.writerPaused;
      fixture.releaseWriter();
      expect(await rejected).toBe(failure);
      expect(await rowsOf(history)).toStrictEqual([batchRow(0)]);
      expect((await fixture.durable()).count).toBe(1);
      expect(history.getTotalTokens()).toBe(4);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('restores the committed baseline when acknowledgement cancels the batch', async () => {
    await withNativeDetachedFixture(async ({ history, durable, owners }) => {
      await history.addBatch([batchRow(0)]);
      const controller = new AbortController();
      const failure = new Error('cancel acknowledged batch');
      await expect(
        history.detachedValues.append([batchRow(1)], undefined, {
          signal: controller.signal,
          onAcknowledged: () => controller.abort(failure),
        }),
      ).rejects.toBe(failure);
      expect(await rowsOf(history)).toStrictEqual([batchRow(0)]);
      expect((await durable()).count).toBe(1);
      expect(history.getTotalTokens()).toBe(4);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});
