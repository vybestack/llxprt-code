/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import {
  batchGate,
  batchRow,
} from './__tests__/support/addbatch-stream-test-helpers.js';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import { batchRowSource } from './batch-event-test-helpers.js';
import {
  exactTokenizer,
  rejectedValue,
  rowsOf,
} from './chronology-rollback-test-helpers.js';

describe('journal batch observer publication barrier', () => {
  it('finishes active batch readers before publishing tokens or returning', async () => {
    const history = new HistoryService();
    history.setTokenizerFactory(exactTokenizer());
    const ready = batchGate();
    const gate = batchGate();
    const order: string[] = [];
    let reading: Promise<void> | undefined;
    history.once('contentBatchAdded', (value) => {
      reading = (async (): Promise<void> => {
        for await (const row of batchRowSource(value).rows()) {
          expect(row).toStrictEqual(batchRow(0));
          ready.resolve();
          await gate.promise;
          order.push('row');
        }
      })();
    });
    history.on('tokensUpdated', () => order.push('tokens'));
    const operation = history.addBatch([batchRow(0)]);
    try {
      await ready.promise;
      expect(order).toStrictEqual([]);
      gate.resolve();
      await operation;
      await reading;
      expect(order).toStrictEqual(['row', 'tokens']);
    } finally {
      gate.resolve();
      await operation;
      await reading;
      await history.dispose();
    }
  });

  it('compensates a failed batch read and preserves its error identity', async () => {
    await withNativeDetachedFixture(async ({ history, io, owners }) => {
      let reading: Promise<unknown> | undefined;
      history.once('contentBatchAdded', (value) => {
        io.zeroNext('read');
        reading = (async (): Promise<void> => {
          const rows = [];
          for await (const row of batchRowSource(value).rows()) rows.push(row);
        })().catch((error: unknown) => error);
      });
      const result = await rejectedValue(history.addBatch([batchRow(0)]));
      expect(result).toBeInstanceOf(Error);
      expect(result).toBe(await reading);
      expect(await rowsOf(history)).toStrictEqual([]);
      expect(history.getTotalTokens()).toBe(0);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});
