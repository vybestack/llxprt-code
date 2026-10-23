/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import {
  exactTokenizer,
  rejectedValue,
  rowsOf,
} from './chronology-rollback-test-helpers.js';
import type { IContent } from './IContent.js';

async function* values(size: number): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++) yield batchRow(index);
}

describe('maintained scalar length during journal publication', () => {
  for (const size of [512, 8192]) {
    it(`counts all ${size} ordered rows exactly once across acknowledgement`, async () => {
      await withNativeDetachedFixture(async ({ history, owners }) => {
        await history.detachedValues.append(values(size), undefined, {
          publishBatch: true,
        });
        const before = owners.snapshot().acquisitions;
        for (let index = 0; index < 512; index++)
          expect(history.length()).toBe(size);
        expect(owners.snapshot().acquisitions).toBe(before);
        await history.waitForCommit();
        const rows = await rowsOf(history);
        expect(rows).toStrictEqual(
          Array.from({ length: size }, (_, index) => batchRow(index)),
        );
        expect(history.length()).toBe(rows.length);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(owners.snapshot().peakRows).toBeLessThanOrEqual(440);
        expect(owners.snapshot().peakSerializedBytes).toBeLessThanOrEqual(
          8 * 1024 * 1024,
        );
      });
    }, 180_000);
  }

  it('restores emptiness after observer compensation and counts compression replay once', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      const failure = new Error('observer failed');
      history.once('contentBatchAdded', () => {
        throw failure;
      });
      expect(await rejectedValue(history.addBatch([batchRow(0)]))).toBe(
        failure,
      );
      expect(history.length()).toBe(0);
      history.startCompression();
      history.add(batchRow(1));
      history.add(batchRow(2));
      expect(history.length()).toBe(0);
      history.endCompression();
      await history.waitForCommit();
      expect(history.length()).toBe(2);
      expect((await rowsOf(history)).map((row) => row.blocks)).toStrictEqual([
        batchRow(1).blocks,
        batchRow(2).blocks,
      ]);
    });
  });

  for (const stage of ['tokenizer']) {
    it(`does not advance the scalar count on a failed ${stage} write`, async () => {
      await withNativeDetachedFixture(async ({ history }) => {
        await history.addBatch([batchRow(0)]);
        const failure = new Error('admission failed');
        history.setTokenizerFactory(
          exactTokenizer(() => {
            throw failure;
          }),
        );
        expect(await rejectedValue(history.addBatch([batchRow(1)]))).toBe(
          failure,
        );
        expect(history.length()).toBe(1);
        history.setTokenizerFactory(exactTokenizer());
        await history.addBatch([batchRow(2)]);
        await history.waitForCommit();
        expect(history.length()).toBe(2);
      });
    });
  }
});
