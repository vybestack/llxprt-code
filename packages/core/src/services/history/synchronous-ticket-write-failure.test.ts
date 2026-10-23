/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  exactTokenizer,
  rejectedValue,
  rowsOf,
} from './chronology-rollback-test-helpers.js';

describe('journal admission failures', () => {
  for (const writeNumber of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`preserves error identity and retry when row ${writeNumber} admission fails`, async () => {
      await withNativeDetachedFixture(async ({ history, owners }) => {
        const failure = new Error(`row ${writeNumber} admission failed`);
        let remaining = writeNumber;
        history.setTokenizerFactory(
          exactTokenizer(() => {
            if (--remaining === 0) throw failure;
          }),
        );
        expect(
          await rejectedValue(
            history.addBatch(
              Array.from({ length: 8 }, (_, index) => batchRow(index)),
            ),
          ),
        ).toBe(failure);
        expect(history.length()).toBe(0);
        expect(await rowsOf(history)).toStrictEqual([]);
        history.setTokenizerFactory(exactTokenizer());
        await history.addBatch([batchRow(8)]);
        await history.waitForCommit();
        expect(await rowsOf(history)).toStrictEqual([batchRow(8)]);
        expect(history.length()).toBe(1);
        expect(owners.snapshot().liveRows).toBe(0);
      });
    });
  }
});
