/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { withSynchronousFixture } from './synchronous-ticket-test-helpers.js';
import { batchRow } from './addbatch-stream-test-helpers.js';

describe('synchronous spool acquisition failure', () => {
  it('does not publish a record when synchronous ticket acquisition fails and accepts retry', async () => {
    await withSynchronousFixture(async ({ history, recorder }) => {
      const failure = new Error('spool write failed');
      const original = fs.writeSync;
      const write = spyOn(fs, 'writeSync')
        .mockImplementationOnce(original)
        .mockImplementationOnce(original)
        .mockImplementationOnce(original)
        .mockImplementationOnce(original)
        .mockImplementationOnce(() => {
          throw failure;
        });
      try {
        expect(() => history.add(batchRow(0))).toThrow(failure);
        expect(history.length()).toBe(0);
      } finally {
        write.mockRestore();
      }
      history.add(batchRow(1));
      await history.waitForCommit();
      await history.waitForTokenUpdates();
      let count = 0;
      for await (const row of history.streamRawHistory()) {
        expect(row.blocks).toStrictEqual(batchRow(1).blocks);
        count++;
      }
      expect(count).toBe(1);
      expect(recorder.isActive()).toBe(true);
    });
  });
});
