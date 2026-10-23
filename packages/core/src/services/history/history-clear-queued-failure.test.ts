/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchGate } from './__tests__/support/addbatch-stream-test-helpers.js';
import {
  withRemovalFixture,
  removalReferences,
  removalRow,
  assertRemovalRows,
} from './history-removals-test-helpers.js';

describe('queued journal clear failure', () => {
  it('does not release restored media when a queued clear observer rejects', async () => {
    await withRemovalFixture(async ({ history }, store) => {
      const [reference] = await removalReferences(store);
      const input = [removalRow(0, reference)];
      await history.addBatch(input);
      const entered = batchGate();
      const release = batchGate();
      const replacing = history.replaceBatch(input, undefined, {
        afterPublication: async () => {
          entered.resolve();
          await release.promise;
        },
      });
      await entered.promise;
      const failure = new Error('queued clear observer failed');
      const rejectClear = (): void => {
        throw failure;
      };
      history.on('tokensUpdated', rejectClear);
      try {
        const cleared = history.clear().then(
          () => undefined,
          (error: unknown) => error,
        );
        release.resolve();
        await replacing;
        expect(await cleared).toBe(failure);
        expect(history.length()).toBe(1);
      } finally {
        release.resolve();
        history.off('tokensUpdated', rejectClear);
      }
      await history.waitForOwnershipSettlement();
      await assertRemovalRows(history.streamRawHistory(), input);
      expect(await store.hasReservations(reference.contentId)).toBe(true);
    });
  });
});
describe('queued clear and append', () => {
  it('keeps media from an append queued after a journal clear', async () => {
    await withRemovalFixture(async ({ history }, store) => {
      const [previous, incoming] = await removalReferences(store);
      const input = [removalRow(0, previous)];
      const next = removalRow(1, incoming);
      await history.addBatch(input);
      const entered = batchGate();
      const release = batchGate();
      const replacing = history.replaceBatch(input, undefined, {
        afterPublication: async () => {
          entered.resolve();
          await release.promise;
        },
      });
      await entered.promise;
      try {
        const cleared = history.clear();
        history.add(next);
        release.resolve();
        await replacing;
        await cleared;
        await history.waitForCommit();
        await history.waitForOwnershipSettlement();
        await assertRemovalRows(history.streamRawHistory(), [next]);
        expect(await store.hasReservations(previous.contentId)).toBe(false);
        expect(await store.hasReservations(incoming.contentId)).toBe(true);
      } finally {
        release.resolve();
      }
    });
  });
});
