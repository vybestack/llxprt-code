/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withBatchFixture } from './addbatch-stream-test-helpers.js';
import { repairRow, replacementFor } from './tool-repair-disk-test-helpers.js';

async function exercisePending(size: number): Promise<number> {
  return withBatchFixture(async ({ history, owners }) => {
    const input = Array.from({ length: size }, (_, index) =>
      repairRow(index, size),
    );
    owners.registerInput(input);
    await history.addBatch(input);
    await history.waitForCommit();
    for (const index of [0, size - 1])
      expect(
        await history.replaceToolResponseBlock(index, 2, replacementFor(index)),
      ).toBe(true);
    history.validateAndFix();
    await history.waitForTokenUpdates();
    let position = 0;
    let syntheticCount = 0;
    let previousSeq = -1;
    for await (const row of history.streamRawHistory()) {
      if (row.metadata?.synthetic === true) {
        syntheticCount++;
        continue;
      }
      const chronology = row.metadata?.chronology;
      if (chronology === undefined)
        throw new Error(`Row ${position} lost its chronology marker`);
      expect(chronology.seq).toBeGreaterThan(previousSeq);
      previousSeq = chronology.seq;
      if (position !== 0 && position !== size - 1)
        expect(row.blocks).toStrictEqual(input[position].blocks);
      else {
        expect(row.blocks[2]).toStrictEqual(replacementFor(position));
        expect(input[position].blocks[2]).toHaveProperty('result', {
          index: position,
        });
      }
      position++;
    }
    expect([position, syntheticCount]).toStrictEqual([size, 3]);
    expect([
      owners.snapshot().liveRows,
      owners.snapshot().liveSerializedBytes,
    ]).toStrictEqual([0, 0]);
    return position;
  });
}

describe('pending disk repair', () => {
  it.each([512, 8192])(
    'repairs tool responses over %i durable rows with a live writer, preserving row values and chronology order',
    async (size) => {
      expect(await exercisePending(size)).toBe(size);
    },
    180000,
  );
});
