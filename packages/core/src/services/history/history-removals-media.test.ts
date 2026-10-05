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
import type { IContent, ChronologyMarker } from './IContent.js';

function registerRemovalScale(size: number): void {
  describe('settled media removals', () => {
    it(`settles shared and removed media through pop and matching removal over ${size} mixed rows`, async () => {
      await withRemovalFixture(async ({ history, recorder, owners }, store) => {
        const [shared, removed] = await removalReferences(store);
        const input = Array.from({ length: size }, (_, index) =>
          removalRow(index, index === size - 1 ? removed : shared),
        );
        for (const content of input)
          await recorder.commit('content', { content });
        await history.settleMediaOwnership();
        const tail = await history.pop();
        expect(tail).toStrictEqual(input[size - 1]);
        expect(tail).not.toBe(input[size - 1]);
        await history.waitForOwnershipSettlement();
        const sharedAfterPop = await store.hasReservations(shared.contentId);
        expect(await store.hasReservations(removed.contentId)).toBe(false);
        expect(await history.removeLastIfMatches(input[size - 2])).toBe(true);
        await history.waitForOwnershipSettlement();
        await assertRemovalRows(history.streamRawHistory(), input.slice(0, -2));
        expect([
          sharedAfterPop,
          await store.hasReservations(shared.contentId),
        ]).toStrictEqual([true, true]);
        recordRemovalOwners('settled-removals', size, owners);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        history.clear();
        await history.waitForOwnershipSettlement();
        expect(history.length()).toBe(0);
        expect(await store.hasReservations(shared.contentId)).toBe(false);
        expect(owners.snapshot().liveRows).toBe(0);
      });
    }, 180000);
  });
}

describe('disk history removals and real media ownership', () => {
  for (const size of [512, 8192]) registerRemovalScale(size);

  it('preserves strong pending caller and marker identities and queued append order', async () => {
    await withRemovalFixture(
      async ({ history, pauseWriter, waitForPausedWrite }, store) => {
        const [reference] = await removalReferences(store);
        const first = removalRow(0, reference);
        const marker: ChronologyMarker = {
          seq: 2,
          userTurn: 1,
          step: 1,
          recordedAt: 1700000000001,
        };
        const tail: IContent = {
          ...removalRow(1, reference),
          metadata: { chronology: marker },
        };
        pauseWriter();
        history.add(first);
        history.add(tail);
        await waitForPausedWrite;
        await history.waitForTokenUpdates();
        const popping = history.pop();
        const queued = batchRow(2);
        history.add(queued);
        expect(await popping).toBe(tail);
        expect(tail.metadata?.chronology).toBe(marker);
        await assertRemovalRows(
          history.streamRawHistory(),
          [first, queued],
          true,
        );
        expect(await store.hasReservations(reference.contentId)).toBe(true);
        expect(await history.removeLastIfMatches(batchRow(99))).toBe(false);
      },
    );
  });
});

describe('pending clear and large-row identity', () => {
  it('clears synchronously with pending writer rows, releases references and retains chronology counters', async () => {
    await withRemovalFixture(
      async (
        { history, pauseWriter, waitForPausedWrite, releaseWriter },
        store,
      ) => {
        const [reference] = await removalReferences(store);
        const input = [removalRow(0, reference), removalRow(1, reference)];
        pauseWriter();
        history.addAll(input);
        await waitForPausedWrite;
        await history.waitForTokenUpdates();
        await history.settleMediaOwnership();
        history.clear();
        expect(history.length()).toBe(0);
        expect(history.getTotalTokens()).toBe(0);
        expect(history.getContextRange().removedInterior).toContainEqual({
          start: 1,
          end: 2,
          reason: 'cleared',
        });
        await history.waitForOwnershipSettlement();
        expect(await store.hasReservations(reference.contentId)).toBe(false);
        const next: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'next' }],
        };
        history.add(next);
        expect(history.getLastUserContent()).toBe(next);
        expect(next).toHaveProperty('metadata.chronology.seq', 3);
        releaseWriter();
        await history.waitForCommit();
        expect(history.getLastUserContent()).toStrictEqual(next);
      },
    );
  });

  it('returns a valid nine-MiB pending row by identity and a settled row by detached value', async () => {
    await withRemovalFixture(
      async ({ history, pauseWriter, waitForPausedWrite, releaseWriter }) => {
        const large = batchRow(0, 9 * 1024 * 1024);
        pauseWriter();
        history.add(large);
        await waitForPausedWrite;
        await history.waitForTokenUpdates();
        expect(await history.pop()).toBe(large);
        releaseWriter();
        await history.waitForCommit();
        history.add(large);
        await history.waitForTokenUpdates();
        await history.waitForCommit();
        const removed = await history.pop();
        expect(removed).not.toBe(large);
        expect(removed).toStrictEqual(large);
      },
    );
  }, 180000);
});
