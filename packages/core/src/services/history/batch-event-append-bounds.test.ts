/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { withValueTransformFixture } from './transform-value-test-helpers.js';
import {
  batchText,
  eventRows,
  visitBatch,
} from './batch-event-test-helpers.js';

describe('cold append suffix batch event ownership', () => {
  it.each([512, 8192])(
    'visits every one of %i appended rows under the unchanged 440 / 8 MiB cap',
    async (size) => {
      await withValueTransformFixture(async ({ history, owners }) => {
        await history.detachedValues.append(eventRows(1));
        let count = 0;
        history.once('contentBatchAdded', (values) => {
          expect(values.length).toBe(size);
          count = visitBatch(values, (row) => {
            expect(batchText(row)).toBe(`${count++}:` + 'x'.repeat(2048));
          });
        });
        await history.detachedValues.append(eventRows(size), undefined, {
          streamPublication: true,
        });
        await history.waitForCommit();
        const output = process.env.BATCH_EVENT_APPEND_OUTPUT;
        if (output !== undefined)
          appendFileSync(
            output,
            JSON.stringify({ size, count, ...owners.snapshot() }) + '\n',
          );
        expect(history.length()).toBe(size + 1);
        expect(count).toBe(size);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
      });
    },
    120000,
  );
});
