/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRemovalFixture,
  removalReferences,
  removalRow,
  assertRemovalRows,
  recordRemovalOwners,
} from './history-removals-test-helpers.js';
import { batchRow } from './addbatch-stream-test-helpers.js';

function registerPendingRemoval(size: number): void {
  describe('queued append during removal', () => {
    it(`removes the tail of ${size} mixed rows by detached value and keeps no caller-owned rows`, async () => {
      await withRemovalFixture(async ({ history, owners }, store) => {
        const [shared, removed] = await removalReferences(store);
        const input = Array.from({ length: size }, (_, index) =>
          removalRow(index, index === size - 1 ? removed : shared),
        );
        await history.addBatch(input);
        await history.waitForTokenUpdates();
        await history.settleMediaOwnership();
        const stored = await Array.fromAsync(history.streamRawHistory());
        const popping = history.pop();
        const queued = batchRow(size);
        history.add(queued);
        const popped = await popping;
        expect(popped).toStrictEqual(stored[size - 1]);
        expect(popped).not.toBe(input[size - 1]);
        await history.waitForOwnershipSettlement();
        await assertRemovalRows(history.streamRawHistory(), [
          ...stored.slice(0, -1),
          queued,
        ]);
        expect(await store.hasReservations(removed.contentId)).toBe(false);
        expect(await store.hasReservations(shared.contentId)).toBe(true);
        recordRemovalOwners('pending-removals', size, owners);
        history.clear();
        expect(history.length()).toBe(0);
        await history.waitForOwnershipSettlement();
        expect(await store.hasReservations(shared.contentId)).toBe(false);
        await history.waitForCommit();
        expect(history.length()).toBe(0);
        expect(owners.snapshot().liveRows).toBe(0);
      });
    }, 180000);
  });
}

describe('history removals ownership contract', () => {
  for (const size of [512, 8192]) registerPendingRemoval(size);
});
