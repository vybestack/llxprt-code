/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import { createRowCounters } from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import type { HistoryCheckpoint } from './historyCheckpointRows.js';

async function collect(
  source: AsyncIterable<IContent> | Iterable<IContent>,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of source) rows.push(row);
  return rows;
}

async function assertOutcome(
  operation: Promise<void>,
  fails: boolean,
  failure: Error,
): Promise<void> {
  if (fails) await expect(operation).rejects.toBe(failure);
  else await operation;
}

describe('native detached capture version and owner lifecycle', () => {
  for (const fails of [false, true]) {
    it(`keeps both pinned traversals unchanged across queued clear and releases owners after ${fails ? 'failure' : 'success'}`, async () => {
      const owners = new RowOwnership();
      const counters = createRowCounters();
      const history = new HistoryService({
        mutationOwnership: owners,
        attachmentCounters: { ...counters.counters, ownership: owners },
      });
      const expected = Array.from({ length: 12 }, (_, index) =>
        suffixRow(index, 64),
      );
      const failure = new Error('checkpoint callback failed');
      let escaped: HistoryCheckpoint | undefined;
      try {
        await history.addBatch(expected);
        const operation = history.detachedValues.withCheckpoint(
          async (checkpoint) => {
            escaped = checkpoint;
            expect(checkpoint.length).toBe(12);
            expect(await collect(checkpoint)).toStrictEqual(expected);
            history.startCompression();
            const cleared = history.clear();
            history.add(suffixRow(12, 64));
            history.endCompression();
            await cleared;
            await history.waitForPendingOperations();
            expect(await collect(checkpoint)).toStrictEqual(expected);
            expect(await collectRawHistory(history)).toStrictEqual([
              suffixRow(12, 64),
            ]);
            if (fails) throw failure;
          },
        );
        await assertOutcome(operation, fails, failure);
        if (escaped === undefined) throw new Error('Missing captured source');
        await expect(collect(escaped)).rejects.toThrow('pin was released');
        expect(owners.snapshot().acquisitions).toBeGreaterThan(0);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(owners.snapshot().liveSerializedBytes).toBe(0);
        expect(counters.snapshot().peakDecodedRows).toBe(1);
        await history.addBatch([suffixRow(13, 64)]);
        expect(await collectRawHistory(history)).toStrictEqual([
          suffixRow(12, 64),
          suffixRow(13, 64),
        ]);
      } finally {
        await history.dispose();
      }
    });
  }
});
