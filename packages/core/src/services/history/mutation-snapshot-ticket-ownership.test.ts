/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withBatchFixture, batchRow } from './addbatch-stream-test-helpers.js';

describe('mutation snapshot disk ticket ownership', () => {
  it('releases each decoded pending row with its acquired identity', async () => {
    await withBatchFixture(
      async ({ history, owners, pauseWriter, releaseWriter }) => {
        pauseWriter();
        const input = batchRow(0);
        history.add(input);
        let beforeClose = -1;
        try {
          await history.withRawHistorySnapshot(async (snapshot) => {
            expect(snapshot.length).toBe(1);
            const first = snapshot.readRow(0);
            const second = snapshot.readRow(0);
            expect(first).toStrictEqual(input);
            expect(second).toStrictEqual(input);
            expect(first).not.toBe(second);
            for (const row of snapshot) expect(row).toStrictEqual(input);
            beforeClose = owners.snapshot().liveRows;
          });
          expect({
            beforeClose,
            afterClose: owners.snapshot().liveRows,
          }).toStrictEqual({ beforeClose: 0, afterClose: 0 });
        } finally {
          releaseWriter();
        }
      },
    );
  });

  it('bounds decoded owners while 512 pending disk tickets remain captured', async () => {
    await withBatchFixture(
      async ({ history, owners, pauseWriter, releaseWriter }) => {
        pauseWriter();
        const input = Array.from({ length: 512 }, (_, index) =>
          batchRow(index),
        );
        for (const row of input) history.add(row);
        let beforeClose = -1;
        try {
          await history.withRawHistorySnapshot(async (snapshot) => {
            expect(snapshot.length).toBe(input.length);
            let index = 0;
            for (const row of snapshot)
              expect(row).toStrictEqual(input[index++]);
            expect(index).toBe(input.length);
            beforeClose = owners.snapshot().liveRows;
            expect(owners.snapshot().peakRows).toBeLessThanOrEqual(2);
          });
          expect({
            beforeClose,
            afterClose: owners.snapshot().liveRows,
          }).toStrictEqual({ beforeClose: 0, afterClose: 0 });
        } finally {
          releaseWriter();
        }
      },
    );
  });
});
