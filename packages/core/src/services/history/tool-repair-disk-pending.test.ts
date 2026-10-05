/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withBatchFixture } from './addbatch-stream-test-helpers.js';
import {
  repairRow,
  replacementFor,
  recordRepairOwners,
} from './tool-repair-disk-test-helpers.js';

async function exercisePending(size: number): Promise<void> {
  await withBatchFixture(
    async ({
      history,
      owners,
      pauseWriter,
      waitForPausedWrite,
      releaseWriter,
    }) => {
      const input = Array.from({ length: size }, (_, index) =>
        repairRow(index, size),
      );
      owners.registerInput(input);
      pauseWriter();
      await history.addBatch(input);
      await waitForPausedWrite;
      for (const index of [0, size - 1])
        expect(
          await history.replaceToolResponseBlock(
            index,
            2,
            replacementFor(index),
          ),
        ).toBe(true);
      history.validateAndFix();
      await history.waitForTokenUpdates();
      let position = 0;
      let syntheticCount = 0;
      for await (const row of history.streamRawHistory()) {
        if (row.metadata?.synthetic === true) {
          syntheticCount++;
          continue;
        }
        expect(row.metadata?.chronology).toBe(
          input[position].metadata?.chronology,
        );
        if (position !== 0 && position !== size - 1)
          expect(row).toBe(input[position]);
        else {
          expect(row.blocks[2]).toStrictEqual(replacementFor(position));
          expect(input[position].blocks[2]).toHaveProperty('result', {
            index: position,
          });
        }
        position++;
      }
      expect([position, syntheticCount]).toStrictEqual([size, 3]);
      recordRepairOwners('pending', size, owners);
      expect(owners.snapshot().peakRows).toBeGreaterThanOrEqual(size);
      try {
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(process.env.TOOL_REPAIR_PENDING_TRAP === '1');
      } finally {
        releaseWriter();
        await history.waitForCommit();
        expect([
          owners.snapshot().liveRows,
          owners.snapshot().liveSerializedBytes,
        ]).toStrictEqual([0, 0]);
      }
    },
  );
}

describe('pending disk repair identity owners', () => {
  it.each([512, 8192])(
    'preserves caller objects and marker identity over %i rows without waiting for the paused writer',
    async (size) => {
      await expect(exercisePending(size)).resolves.toBeUndefined();
    },
    180000,
  );
});
