/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRemovalFixture,
  removalReferences,
} from './history-removals-test-helpers.js';
import { repairRow, replacementFor } from './tool-repair-disk-test-helpers.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';

describe('tool repair duplicate media references', () => {
  it.each([512, 8192])(
    'preserves repeated media reservations through successful and failed rewrites over %i mixed rows',
    async (size) => {
      await withRemovalFixture(async ({ history, recorder, owners }, store) => {
        const [shared, tail] = await removalReferences(store);
        for (let index = 0; index < size; index++) {
          const row = repairRow(index, size);
          const reference = index === size - 1 ? tail : shared;
          await recorder.commit('content', {
            content: { ...row, blocks: [...row.blocks, reference, reference] },
          });
        }
        await history.settleMediaOwnership();
        await history.recalculateTokens();
        const tokens = await history.estimateTokensForContents(
          (function* () {
            for (let index = 0; index < size; index++) {
              const row = repairRow(index, size);
              const reference = index === size - 1 ? tail : shared;
              yield { ...row, blocks: [...row.blocks, reference, reference] };
            }
          })(),
        );
        history.setTokenizerFactory(
          exactTokenizer(() => {
            throw new Error('media rewrite token failure');
          }),
        );
        await expect(
          history.replaceToolResponseBlock(
            size - 1,
            2,
            replacementFor(size - 1),
          ),
        ).rejects.toThrow('media rewrite token failure');
        expect(history.getTotalTokens()).toBe(tokens);
        history.setTokenizerFactory(exactTokenizer());
        expect(
          await history.replaceToolResponseBlock(0, 2, replacementFor(0)),
        ).toBe(true);
        history.validateAndFix();
        await history.waitForTokenUpdates();
        expect(await store.hasReservations(shared.contentId)).toBe(true);
        expect(await store.hasReservations(tail.contentId)).toBe(true);
        let count = 0;
        for await (const row of history.streamRawHistory()) {
          if (row.metadata?.synthetic === true) continue;
          expect(row.blocks.slice(-2)).toStrictEqual(
            count++ === size - 1 ? [tail, tail] : [shared, shared],
          );
        }
        expect(count).toBe(size);
        await history.waitForCommit();
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
      });
    },
    180000,
  );
});
