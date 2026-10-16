/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { withValueTransformFixture } from './transform-value-test-helpers.js';
import { eventRows, visitBatch } from './batch-event-test-helpers.js';
import type { IContent } from './IContent.js';

describe('whole-operation batch event value ownership', () => {
  for (const size of [512, 8192]) {
    it(`streams all ${size} rows under the strict 440 owner / 8 MiB cap`, async () => {
      await withValueTransformFixture(async ({ history, owners }) => {
        let count = 0;
        history.on('contentBatchAdded', (value) => {
          count = visitBatch(value, () => undefined);
        });
        await history.detachedValues.replace(eventRows(size), undefined, {
          publishBatch: true,
        });
        const output = process.env.BATCH_EVENT_OUTPUT;
        if (output !== undefined)
          appendFileSync(
            output,
            JSON.stringify({ size, count, ...owners.snapshot() }) + '\n',
          );
        expect(count).toBe(size);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
      });
    }, 120000);
    it(`detects a subscriber that retains all ${size} decoded rows`, async () => {
      await withValueTransformFixture(async ({ history, owners }) => {
        const retained: IContent[] = [];
        history.once('contentBatchAdded', (value) => {
          visitBatch(value, (row) => {
            retained.push(row);
            owners.retain(row);
          });
        });
        try {
          await history.detachedValues.replace(eventRows(size), undefined, {
            publishBatch: true,
          });
          expect(retained.length).toBe(size);
          expect(owners.snapshot().liveRows).toBe(size);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(false);
        } finally {
          for (const row of retained) owners.release(row);
          retained.length = 0;
        }
        expect(owners.snapshot().liveRows).toBe(0);
      });
    }, 120000);
  }
});
