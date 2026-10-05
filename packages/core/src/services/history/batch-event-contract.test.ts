/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withValueTransformFixture } from './transform-value-test-helpers.js';
import { batchRow } from './addbatch-stream-test-helpers.js';
import {
  batchValues,
  batchText,
  eventRows,
  visitBatch,
  type BatchTestCursor,
  type BatchTestValues,
} from './batch-event-test-helpers.js';

describe('scoped synchronous contentBatchAdded', () => {
  it('publishes only the append suffix and the full replacement in order', async () => {
    await withValueTransformFixture(async ({ history }) => {
      await history.addBatch([batchRow(99)]);
      const batches: string[][] = [];
      history.on('contentBatchAdded', (value) => {
        const texts: string[] = [];
        visitBatch(value, (row) => {
          texts.push(batchText(row));
        });
        batches.push(texts);
      });
      await history.detachedValues.append(eventRows(3));
      await history.detachedValues.replace(eventRows(2), undefined, {
        publishBatch: true,
      });
      expect(batches).toStrictEqual([
        [0, 1, 2].map((i) => `${i}:` + 'x'.repeat(2048)),
        [0, 1].map((i) => `${i}:` + 'x'.repeat(2048)),
      ]);
    });
  });
  it('expires both the view and an escaped cursor before token publication', async () => {
    await withValueTransformFixture(async ({ history, owners }) => {
      let held: BatchTestValues | undefined;
      let escaped: BatchTestCursor | undefined;
      history.on('contentBatchAdded', (value) => {
        held = batchValues(value);
        held.withRows((cursor) => {
          escaped = cursor;
          expect(cursor.next().done).toBe(false);
        });
        expect(owners.snapshot().liveRows).toBe(0);
      });
      history.on('tokensUpdated', () => {
        if (held === undefined || escaped === undefined)
          throw new Error('Missing event handles');
        expect(() => held?.withRows(() => undefined)).toThrow('closed');
        expect(() => escaped?.next()).toThrow('closed');
        expect(() => held?.length).toThrow('closed');
      });
      await history.detachedValues.replace(eventRows(3), undefined, {
        publishBatch: true,
      });
    });
  });
});

describe('independent batch listeners and failure cleanup', () => {
  it('supports repeated independent listeners with early release and no shared row mutation', async () => {
    await withValueTransformFixture(async ({ history, owners }) => {
      const counts: number[] = [];
      history.on('contentBatchAdded', (value) => {
        batchValues(value).withRows((cursor) => {
          const item = cursor.next();
          if (item.done === true) throw new Error('Missing first row');
          item.value.blocks = [];
          cursor.return();
          expect(() => cursor.next()).toThrow('closed');
        });
        counts.push(owners.snapshot().liveRows);
      });
      history.on('contentBatchAdded', (value) => {
        counts.push(
          visitBatch(value, (row) => {
            expect(row.blocks.length).toBe(1);
          }),
        );
        counts.push(visitBatch(value, () => undefined));
      });
      await history.detachedValues.replace(eventRows(3), undefined, {
        publishBatch: true,
      });
      expect(counts).toStrictEqual([0, 3, 3]);
    });
  });
  it('rejects nested readers and releases a row when the visitor throws', async () => {
    await withValueTransformFixture(async ({ history, owners }) => {
      const failure = new Error('batch reader visitor');
      let late = false;
      history.on('contentBatchAdded', (value) => {
        const view = batchValues(value);
        expect(() =>
          view.withRows((cursor) => {
            cursor.next();
            expect(() => view.withRows(() => undefined)).toThrow('active');
            throw failure;
          }),
        ).toThrow(failure);
        expect(owners.snapshot().liveSerializedBytes).toBe(0);
        throw failure;
      });
      history.on('contentBatchAdded', () => {
        late = true;
      });
      await expect(
        history.detachedValues.replace(eventRows(3), undefined, {
          publishBatch: true,
        }),
      ).rejects.toBe(failure);
      expect(late).toBe(false);
      expect(history.length()).toBe(0);
      expect(history.getTotalTokens()).toBe(0);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});

describe('native batch dispatch and reentrancy', () => {
  it('keeps native ordered on once prepend off and current-dispatch listener semantics', async () => {
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
  it('closes the event before reentrant mutations leave the FIFO', async () => {
    await withValueTransformFixture(async ({ history }) => {
      const order: string[] = [];
      let queued: Promise<void> | undefined;
      let held: BatchTestValues | undefined;
      history.once('contentBatchAdded', (value) => {
        held = batchValues(value);
        order.push('batch');
        history.add(batchRow(9));
        queued = history.addBatch([batchRow(10)]);
        expect(history.length()).toBe(2);
      });
      history.on('contentAdded', () => {
        order.push('queued-add');
        expect(() => held?.withRows(() => undefined)).toThrow('closed');
      });
      await history.detachedValues.replace(eventRows(2), undefined, {
        publishBatch: true,
      });
      await queued;
      expect(order).toStrictEqual(['batch', 'queued-add']);
      expect(history.length()).toBe(4);
    });
  });
});

describe('complete oversized batch values', () => {
  it('delivers a complete row larger than nine MiB without a universal byte rejection', async () => {
    await withValueTransformFixture(async ({ history }) => {
      let bytes = 0;
      history.on('contentBatchAdded', (value) => {
        expect(
          visitBatch(value, (row) => {
            bytes = Buffer.byteLength(batchText(row));
          }),
        ).toBe(1);
      });
      await history.detachedValues.replace(
        eventRows(1, 9 * 1024 * 1024 + 37),
        undefined,
        { publishBatch: true },
      );
      expect(bytes).toBe(9 * 1024 * 1024 + 39);
    });
  });
});
