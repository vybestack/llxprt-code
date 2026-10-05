/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  withSuffixFixture,
  rowIndex,
} from '../../../../core/src/services/history/history-suffix-test-helpers.js';
import {
  TruncationStreamHistory,
  truncationHandler,
  truncationRow,
  collectRows,
} from './truncation-stream-helpers.js';

async function boundedCompression(
  size: number,
): Promise<PerformCompressionResult> {
  const mutation = new RowOwnership();
  return withSuffixFixture(
    size,
    async (history, reader) => {
      const handler = truncationHandler(history);
      history.syncTotalTokens(size);
      await history.waitForTokenUpdates();
      history.setCacheAnchorSeq(1);
      const outcome = await handler.performCompression('bounded');
      expect(outcome).toBe(PerformCompressionResult.COMPRESSED);
      const rows = await collectRows(history);
      expect(rows.map(rowIndex)).toStrictEqual(
        Array.from({ length: 29 }, (_, index) => size - 29 + index),
      );
      expect(rows[0].metadata?.semanticMediaPurgeFrontier).toStrictEqual({
        contentIndex: 1,
        blockIndex: 0,
      });
      expect(rows.every((row) => row.metadata?.cacheAnchor !== true)).toBe(
        true,
      );
      expect(rows.map((row) => row.metadata?.chronology?.seq)).toStrictEqual(
        Array.from({ length: 29 }, (_, index) => size - 28 + index),
      );
      expect(history.getCacheAnchorSeq()).toBe(0);
      expect(
        reader.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(
        mutation.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      expect(reader.snapshot().liveRows + mutation.snapshot().liveRows).toBe(0);
      return outcome;
    },
    2048,
    truncationRow,
    mutation,
    (options) => new TruncationStreamHistory(options),
  );
}

describe('production disk-backed truncation', () => {
  it.each([512, 8192])(
    'selects and publishes the recent token suffix of %i actual rows without eager facades',
    async (size) => {
      expect(await boundedCompression(size)).toBe(
        PerformCompressionResult.COMPRESSED,
      );
    },
    120_000,
  );

  it('closes an interrupted hook before publishing the strategy candidate', async () => {
    await withSuffixFixture(
      512,
      async (history) => {
        const handler = truncationHandler(history, async (context) => {
          await context.history.next();
          throw new Error('interrupted hook');
        });
        history.syncTotalTokens(512);
        await history.waitForTokenUpdates();
        expect(await handler.performCompression('hook')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        expect((await collectRows(history)).map(rowIndex)).toStrictEqual(
          Array.from({ length: 29 }, (_, index) => 483 + index),
        );
      },
      64,
      truncationRow,
      undefined,
      (options) => new TruncationStreamHistory(options),
    );
  });

  it('accepts an individual surviving row larger than eight MiB', async () => {
    await withSuffixFixture(
      3,
      async (history) => {
        const handler = truncationHandler(history);
        history.syncTotalTokens(100);
        await history.waitForTokenUpdates();
        expect(await handler.performCompression('large')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        const rows = await collectRows(history);
        expect(rows.map(rowIndex)).toStrictEqual([1, 2]);
        expect(Buffer.byteLength(JSON.stringify(rows[1]))).toBeGreaterThan(
          8 * 1024 * 1024,
        );
      },
      0,
      (index) => truncationRow(index, index === 2 ? 9 * 1024 * 1024 : 0),
      undefined,
      (options) => new TruncationStreamHistory(options),
    );
  }, 120_000);
});
