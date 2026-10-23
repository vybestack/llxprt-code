/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import {
  batchRowSource,
  batchText,
  eventRows,
  readBatch,
} from './batch-event-test-helpers.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';
import { withValueTransformFixture } from './transform-value-test-helpers.js';

describe('journal contentBatchAdded scope', () => {
  it('publishes only the append suffix and the full replacement in order', async () => {
    await withValueTransformFixture(async ({ history }) => {
      await history.addBatch([batchRow(99)]);
      const batches: Array<Promise<string[]>> = [];
      history.on('contentBatchAdded', (value) =>
        batches.push(readBatch(value, batchText)),
      );
      await history.detachedValues.append(eventRows(3));
      await history.detachedValues.replace(eventRows(2), undefined, {
        publishBatch: true,
      });
      expect(await Promise.all(batches)).toStrictEqual([
        [0, 1, 2].map((i) => `${i}:` + 'x'.repeat(2048)),
        [0, 1].map((i) => `${i}:` + 'x'.repeat(2048)),
      ]);
    });
  });

  it('retires event reads before token publication', async () => {
    await withValueTransformFixture(async ({ history, owners }) => {
      let held: HistoryBatchRowSource | undefined;
      let reading: Promise<string[]> | undefined;
      let late: Promise<unknown> | undefined;
      history.once('contentBatchAdded', (value) => {
        held = batchRowSource(value);
        reading = readBatch(value, batchText);
      });
      history.on('tokensUpdated', () => {
        if (held === undefined) throw new Error('Missing batch source');
        late = held
          .rows()
          [Symbol.asyncIterator]()
          .next()
          .catch((error: unknown) => error);
      });
      await history.detachedValues.replace(eventRows(3), undefined, {
        publishBatch: true,
      });
      expect(await reading).toHaveLength(3);
      expect(await late).toBeInstanceOf(Error);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('supports independent listeners and early return without sharing decoded row mutations', async () => {
    await withValueTransformFixture(async ({ history, owners }) => {
      const passes: Array<Promise<unknown>> = [];
      history.on('contentBatchAdded', (value) => {
        passes.push(
          (async (): Promise<void> => {
            for await (const row of batchRowSource(value).rows()) {
              row.blocks = [];
              break;
            }
          })(),
        );
      });
      history.on('contentBatchAdded', (value) => {
        passes.push(readBatch(value, (row) => row.blocks.length));
        passes.push(readBatch(value, batchText));
      });
      await history.detachedValues.replace(eventRows(3), undefined, {
        publishBatch: true,
      });
      const results = await Promise.all(passes);
      expect(results[1]).toStrictEqual([1, 1, 1]);
      expect(results[2]).toHaveLength(3);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('compensates a throwing listener without dispatching later subscribers', async () => {
    await withValueTransformFixture(async ({ history, owners }) => {
      const failure = new Error('batch listener');
      let later = false;
      history.once('contentBatchAdded', () => {
        throw failure;
      });
      history.once('contentBatchAdded', () => {
        later = true;
      });
      await expect(
        history.detachedValues.replace(eventRows(3), undefined, {
          publishBatch: true,
        }),
      ).rejects.toBe(failure);
      expect(later).toBe(false);
      expect(history.length()).toBe(0);
      expect(history.getTotalTokens()).toBe(0);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('preserves once, prepend, off and current-dispatch listener order', async () => {
    await withValueTransformFixture(async ({ history }) => {
      const order: string[] = [];
      const later = (): void => {
        order.push('later');
      };
      const removed = (): void => {
        order.push('removed');
      };
      history.on('contentBatchAdded', () => {
        order.push('first');
        history.off('contentBatchAdded', later);
      });
      history.on('contentBatchAdded', later);
      history.on('contentBatchAdded', removed);
      history.off('contentBatchAdded', removed);
      history.prependOnceListener('contentBatchAdded', () => {
        order.push('prepend-once');
      });
      await history.detachedValues.replace(eventRows(1), undefined, {
        publishBatch: true,
      });
      await history.detachedValues.replace(eventRows(1), undefined, {
        publishBatch: true,
      });
      expect(order).toStrictEqual(['prepend-once', 'first', 'later', 'first']);
    });
  });

  it('completes batch publication before reentrant mutations leave the FIFO', async () => {
    await withValueTransformFixture(async ({ history }) => {
      const order: string[] = [];
      let queued: Promise<void> | undefined;
      history.once('contentBatchAdded', () => {
        order.push('batch');
        history.add(batchRow(9));
        queued = history.addBatch([batchRow(10)]);
        expect(history.length()).toBe(2);
      });
      history.on('contentAdded', () => {
        order.push('queued-add');
      });
      await history.detachedValues.replace(eventRows(2), undefined, {
        publishBatch: true,
      });
      await queued;
      expect(order).toStrictEqual(['batch', 'queued-add']);
      expect(history.length()).toBe(4);
    });
  });

  it('delivers the complete oversized row without a universal byte rejection', async () => {
    await withValueTransformFixture(async ({ history }) => {
      let bytes: Promise<number[]> | undefined;
      history.once('contentBatchAdded', (value) => {
        bytes = readBatch(value, (row) => Buffer.byteLength(batchText(row)));
      });
      await history.detachedValues.replace(
        eventRows(1, 9 * 1024 * 1024 + 37),
        undefined,
        { publishBatch: true },
      );
      expect(await bytes).toStrictEqual([9 * 1024 * 1024 + 39]);
    });
  });
});
