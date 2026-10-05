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
  describe('paused writer removal', () => {
    it(`preserves ${size} caller-owned mixed rows and charges their pins while the writer is paused`, async () => {
      await withRemovalFixture(
        async (
          { history, owners, pauseWriter, waitForPausedWrite, releaseWriter },
          store,
        ) => {
          const [shared, removed] = await removalReferences(store);
          const input = Array.from({ length: size }, (_, index) =>
            removalRow(index, index === size - 1 ? removed : shared),
          );
          owners.registerInput(input);
          pauseWriter();
          await history.addBatch(input);
          await waitForPausedWrite;
          await history.waitForTokenUpdates();
          await history.settleMediaOwnership();
          const popping = history.pop();
          const queued = batchRow(size);
          history.add(queued);
          expect(await popping).toBe(input[size - 1]);
          await history.waitForOwnershipSettlement();
          await assertRemovalRows(
            history.streamRawHistory(),
            [...input.slice(0, -1), queued],
            true,
          );
          expect(await store.hasReservations(removed.contentId)).toBe(false);
          expect(await store.hasReservations(shared.contentId)).toBe(true);
          recordRemovalOwners('pending-removals', size, owners);
          expect(owners.snapshot().peakRows).toBeGreaterThanOrEqual(size);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(process.env.REMOVAL_PENDING_TRAP === '1');
          history.clear();
          const afterClear = history.length();
          await history.waitForOwnershipSettlement();
          expect(await store.hasReservations(shared.contentId)).toBe(false);
          releaseWriter();
          await history.waitForCommit();
          expect({ afterClear, afterCommit: history.length() }).toStrictEqual({
            afterClear: 0,
            afterCommit: 0,
          });
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    }, 180000);
  });
}

describe('pending history removals ownership contract', () => {
  for (const size of [512, 8192]) registerPendingRemoval(size);
});
