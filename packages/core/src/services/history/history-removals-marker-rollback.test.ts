/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRemovalFixture,
  removalReferences,
  removalRow,
  assertRemovalRows,
} from './history-removals-test-helpers.js';
import type { ChronologyMarker, IContent } from './IContent.js';

describe('removal marker rollback', () => {
  it('keeps journal marker values after an observer displaces caller markers and rejects', async () => {
    await withRemovalFixture(
      async (
        { history, pauseWriter, waitForPausedWrite, releaseWriter },
        store,
      ) => {
        const [reference] = await removalReferences(store);
        const markers: ChronologyMarker[] = [
          { seq: 1, userTurn: 1, step: 0, recordedAt: 10 },
          { seq: 2, userTurn: 1, step: 1, recordedAt: 11 },
        ];
        const input: IContent[] = markers.map((chronology, index) => ({
          ...removalRow(index, reference),
          metadata: { chronology },
        }));
        pauseWriter();
        history.addAll(input);
        await waitForPausedWrite;
        await history.waitForTokenUpdates();
        await history.settleMediaOwnership();
        const listener = (): void => {
          for (const row of input)
            row.metadata = {
              chronology: { seq: 90, userTurn: 20, step: 0, recordedAt: 100 },
            };
          throw new Error('marker observer failed');
        };
        history.on('tokensUpdated', listener);
        try {
          await expect(history.pop()).rejects.toThrow('marker observer failed');
        } finally {
          history.off('tokensUpdated', listener);
        }
        const expected = input.map((row, index) => ({
          ...row,
          metadata: { chronology: markers[index] },
        }));
        await assertRemovalRows(history.streamRawHistory(), expected);
        expect(history.getContextRange().lastSeq).toBe(2);
        expect(await store.hasReservations(reference.contentId)).toBe(true);
        releaseWriter();
        await history.waitForCommit();
        await assertRemovalRows(history.streamRawHistory(), expected);
      },
    );
  });
});
