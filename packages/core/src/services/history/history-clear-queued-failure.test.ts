/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchGate } from './addbatch-stream-test-helpers.js';
import {
  withRemovalFixture,
  removalReferences,
  removalRow,
  assertRemovalRows,
} from './history-removals-test-helpers.js';

describe('queued synchronous clear failure', () => {
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
      const rejectClear = (): void => {
        throw new Error('queued clear observer failed');
      };
      history.on('tokensUpdated', rejectClear);
      try {
        history.clear();
        expect(history.length()).toBe(1);
        release.resolve();
        await expect(replacing).rejects.toThrow('queued clear observer failed');
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
  it('keeps media from an append queued after a synchronous clear', async () => {
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
        history.clear();
        history.add(next);
        release.resolve();
        await replacing;
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
