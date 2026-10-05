/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { withSynchronousFixture } from './synchronous-ticket-test-helpers.js';
import { batchRow } from './addbatch-stream-test-helpers.js';

describe('synchronous admission disk write failures', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'preserves error identity and retry after write %i fails',
    async (writeNumber) => {
      await withSynchronousFixture(async ({ history }) => {
        const failure = new Error(`write ${writeNumber} failed`);
        const original = fs.writeSync;
        const write = spyOn(fs, 'writeSync');
        for (let before = 1; before < writeNumber; before++)
          write.mockImplementationOnce(original);
        write.mockImplementationOnce(() => {
          throw failure;
        });
        let actual: unknown;
        try {
          history.add(batchRow(0));
        } catch (error) {
          actual = error;
        } finally {
          write.mockRestore();
        }
        expect(actual).toBe(failure);
        expect(history.length()).toBe(0);
        history.add(batchRow(1));
        await history.waitForCommit();
        await history.waitForTokenUpdates();
        let count = 0;
        for await (const row of history.streamRawHistory()) {
          expect(row.blocks).toStrictEqual(batchRow(1).blocks);
          count++;
        }
        expect(count).toBe(1);
      });
    },
  );
});
