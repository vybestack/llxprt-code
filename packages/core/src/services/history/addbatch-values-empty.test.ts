/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { setImmediate } from 'node:timers/promises';
import { batchRow, withBatchFixture } from './addbatch-stream-test-helpers.js';

describe('empty value append', () => {
  it('keeps an empty batch a FIFO no-op without waiting for an unrelated paused writer', async () => {
    await withBatchFixture(
      async ({
        history,
        pauseWriter,
        waitForPausedWrite,
        releaseWriter,
        owners,
      }) => {
        pauseWriter();
        history.add(batchRow(0));
        await waitForPausedWrite;
        let settled = false;
        let notifications = 0;
        history.on('contentBatchAdded', () => {
          notifications++;
        });
        const empty = history.addBatch([]).then(() => {
          settled = true;
        });
        try {
          await setImmediate();
          expect(settled).toBe(true);
          expect(notifications).toBe(0);
          expect(history.length()).toBe(1);
        } finally {
          releaseWriter();
          await empty;
          await history.waitForCommit();
          await history.waitForTokenUpdates();
        }
        expect(owners.snapshot().liveRows).toBe(0);
      },
    );
  });
});
