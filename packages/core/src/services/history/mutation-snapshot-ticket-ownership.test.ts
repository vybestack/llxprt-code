/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  batchRow,
  withBatchFixture,
} from './__tests__/support/addbatch-stream-test-helpers.js';
import { checkpointRows } from './historyCheckpointRows.js';

describe('mutation checkpoint decoded ownership', () => {
  for (const size of [1, 512]) {
    it(`releases each of ${size} decoded rows with its acquired identity`, async () => {
      await withBatchFixture(async ({ history, owners }) => {
        await history.detachedValues.replace(
          (async function* () {
            for (let index = 0; index < size; index++) yield batchRow(index);
          })(),
        );
        await history.detachedValues.withCheckpoint(async (snapshot) => {
          expect(snapshot.length).toBe(size);
          const first = checkpointRows(snapshot);
          const second = checkpointRows(snapshot);
          const one = await first.next();
          await first.return();
          const two = await second.next();
          expect(one.value).toStrictEqual(batchRow(0));
          expect(two.value).toStrictEqual(batchRow(0));
          expect(one.value).not.toBe(two.value);
          await second.return();
          let index = 0;
          for await (const row of checkpointRows(snapshot))
            expect(row).toStrictEqual(batchRow(index++));
          expect(index).toBe(size);
          expect(owners.snapshot().liveRows).toBe(0);
        });
        expect(owners.snapshot().liveRows).toBe(0);
        expect(owners.snapshot().peakRows).toBeLessThanOrEqual(2);
      });
    });
  }
});
