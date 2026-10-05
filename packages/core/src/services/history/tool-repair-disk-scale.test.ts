/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withBatchFixture } from './addbatch-stream-test-helpers.js';
import {
  repairRow,
  replacementFor,
  assertRepairedPair,
  assertRetainedRepairRow,
  recordRepairOwners,
} from './tool-repair-disk-test-helpers.js';

const bound = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

describe('disk tool replacement and validation repair', () => {
  it.each([512, 8192])(
    'invokes head and tail replacement then repairs multiple missing calls over %i mixed rows',
    async (size) => {
      await withBatchFixture(async ({ history, recorder, owners, reads }) => {
        for (let index = 0; index < size; index++)
          await recorder.commit('content', { content: repairRow(index, size) });
        await history.recalculateTokens();
        for (const index of [0, size - 1])
          expect(
            await history.replaceToolResponseBlock(
              index,
              2,
              replacementFor(index),
            ),
          ).toBe(true);
        const before = history.getTotalTokens();
        history.validateAndFix();
        await history.waitForTokenUpdates();
        let sourceIndex = 0;
        let synthetics = 0;
        let previousWasMissing = false;
        for await (const row of history.streamRawHistory()) {
          if (previousWasMissing) {
            assertRepairedPair(row, sourceIndex - 1, synthetics === 0, size);
            synthetics++;
            previousWasMissing = false;
          } else {
            assertRetainedRepairRow(row, sourceIndex, size);
            previousWasMissing = [0, Math.floor(size / 2), size - 1].includes(
              sourceIndex++,
            );
          }
        }
        expect([sourceIndex, synthetics]).toStrictEqual([size, 3]);
        expect(history.getTotalTokens()).toBe(
          before +
            (await history.estimateTokensForContents(
              (async function* () {
                for await (const row of history.streamRawHistory())
                  if (row.metadata?.synthetic === true) yield row;
              })(),
            )),
        );
        await history.waitForCommit();
        recordRepairOwners('settled', size, owners);
        expect(owners.within(bound)).toBe(true);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(reads.snapshot().peakDecodedRows).toBeLessThanOrEqual(2);
      });
    },
    180000,
  );
});
