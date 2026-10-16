/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRemovalFixture,
  removalReferences,
} from './history-removals-test-helpers.js';
import {
  exportSummaryRow,
  summaryRow,
  assertOwnerBound,
} from './export-summary-test-helpers.js';

describe('disk summary media ownership', () => {
  it.each([512, 8192])(
    'rolls back duplicate media reservations and releases removed owners across %i rows',
    async (size) => {
      await withRemovalFixture(async ({ history, recorder, owners }, store) => {
        const [removed, retained] = await removalReferences(store);
        for (let index = 0; index < size; index++) {
          const reference = index >= size - 3 ? retained : removed;
          const row = exportSummaryRow(index);
          await recorder.commit('content', {
            content: { ...row, blocks: [...row.blocks, reference, reference] },
          });
        }
        await history.settleMediaOwnership();
        await history.recalculateTokens();
        recorder.failAdmissionAfter(2);
        await expect(
          history.summarizeOldHistory(3, async () => summaryRow()),
        ).rejects.toThrow('injected journal admission failure');
        expect(history.length()).toBe(size);
        expect([
          await store.hasReservations(removed.contentId),
          await store.hasReservations(retained.contentId),
        ]).toStrictEqual([true, true]);
        await history.summarizeOldHistory(3, async () => summaryRow());
        expect(history.length()).toBe(4);
        expect(await store.hasReservations(removed.contentId)).toBe(false);
        expect(await store.hasReservations(retained.contentId)).toBe(true);
        let index = 0;
        for await (const row of history.streamRawHistory()) {
          if (index++ === 0) continue;
          expect(row.blocks.slice(-2)).toStrictEqual([retained, retained]);
        }
        expect(index).toBe(4);
        assertOwnerBound(owners);
      });
    },
    180000,
  );
});
