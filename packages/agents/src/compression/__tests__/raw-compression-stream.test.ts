/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { applyCompressionWithAnchor } from '../cacheAnchor.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  compressionRow,
  CursorCompressionHistory,
  expectedCompressionReceipt,
  summaryRow,
} from './raw-compression-fixtures.js';

const rowsBound = 440;
const bytesBound = 8 * 1024 * 1024;
async function publishedValues(history: HistoryService): Promise<IContent[]> {
  await history.waitForCommit();
  const result: IContent[] = [];
  const snapshot = await history.openDumpSnapshot();
  try {
    for await (const row of snapshot.rows()) result.push(row);
  } finally {
    await snapshot.close();
  }
  expect(history.getTotalTokens()).toBe(
    await history.estimateTokensForContents(result, 'test'),
  );
  return result;
}

describe('production compression annotation over pinned raw rows', () => {
  it.each([512, 8192])(
    'annotates %i mixed rows without reading an array facade',
    async (size) => {
      let observed: CursorCompressionHistory | undefined;
      await withSuffixFixture(
        size,
        async (history, journalOwnership, counters) => {
          const kept = [compressionRow(1), compressionRow(size - 1)];
          await applyCompressionWithAnchor(
            history,
            [kept[0], summaryRow(), kept[1]],
            1,
            'test',
          );
          const result = await publishedValues(history);
          expect(kept[0].metadata?.responsesStored).toBe(true);
          expect(kept[0].metadata?.semanticMediaPurgeFrontier).toBeUndefined();
          expect(result.map((row) => row.speaker)).toStrictEqual([
            kept[0].speaker,
            'ai',
            kept[1].speaker,
          ]);
          expect(result[1].metadata?.chronologyReplaced).toStrictEqual({
            fromSeq: 1,
            toSeq: size - 1,
            itemCount: size - 2,
          });
          expect(result[0].metadata?.semanticMediaPurgeFrontier).toStrictEqual({
            contentIndex: 3,
            blockIndex: 1,
            contentId: 'purged-frontier',
          });
          expect(result.map((row) => row.blocks)).toStrictEqual([
            kept[0].blocks,
            summaryRow().blocks,
            kept[1].blocks,
          ]);
          expect(result.map((row) => row.metadata?.cacheAnchor)).toStrictEqual([
            true,
            undefined,
            undefined,
          ]);
          expect(
            result.every((row) => row.metadata?.responsesStored !== true),
          ).toBe(true);
          expect(history.getCacheAnchorSeq()).toBe(2);
          expect(counters.snapshot().peakDecodedRows).toBe(1);
          expect(
            journalOwnership.within({
              rows: rowsBound,
              serializedBytes: bytesBound,
            }),
          ).toBe(true);
          expect(journalOwnership.snapshot().liveRows).toBe(0);
        },
        2048,
        compressionRow,
        undefined,
        (options) => {
          observed = new CursorCompressionHistory(options);
          return observed;
        },
      );
      expect(observed?.replacementReceipt).toBe(
        expectedCompressionReceipt(size),
      );
      expect(observed?.borrowedOwnership.snapshot().peakRows).toBe(1);
      expect(observed?.consumerOwnership.snapshot().peakRows).toBe(2);
      expect(observed?.consumerOwnership.snapshot().liveSerializedBytes).toBe(
        0,
      );
    },
    120_000,
  );
});
