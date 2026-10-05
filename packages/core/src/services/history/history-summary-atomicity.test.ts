/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withBatchFixture, batchGate } from './addbatch-stream-test-helpers.js';
import {
  exportSummaryRow,
  summaryRow,
  seedRows,
  assertOwnerBound,
} from './export-summary-test-helpers.js';
import { collectRawHistory } from '../../test-utils/collect-raw-history.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';

async function unchanged(
  history: Parameters<typeof collectRawHistory>[0],
  size: number,
): Promise<void> {
  expect(await collectRawHistory(history)).toStrictEqual(
    Array.from({ length: size }, (_, i) => exportSummaryRow(i)),
  );
}

describe('disk summary callback lifecycle', () => {
  it('closes abandoned iterators on callback return and exception', async () => {
    await withBatchFixture(async ({ history, recorder, owners }) => {
      await seedRows(recorder, 3);
      let iterator: Iterator<unknown> | undefined;
      await expect(
        history.summarizeOldHistory(1, async (source) => {
          iterator = source[Symbol.iterator]();
          expect(iterator.next().value).toStrictEqual(exportSummaryRow(0));
          throw new Error('summary failed');
        }),
      ).rejects.toThrow('summary failed');
      await unchanged(history, 3);
      const failedIteratorClosed = iterator?.next().done;
      assertOwnerBound(owners);
      await history.summarizeOldHistory(1, async (source) => {
        iterator = source[Symbol.iterator]();
        expect(iterator.next().value).toStrictEqual(exportSummaryRow(0));
        return summaryRow();
      });
      expect([failedIteratorClosed, iterator?.next().done]).toStrictEqual([
        true,
        true,
      ]);
      assertOwnerBound(owners);
    });
  });

  it.each(['abort', 'timeout'])(
    'cancels a stalled callback on %s, closes active rows, and rejects late publication',
    async (mode) => {
      await withBatchFixture(async ({ history, recorder, owners }) => {
        await seedRows(recorder, 3);
        const entered = batchGate();
        const late = batchGate();
        const controller = new AbortController();
        const signal =
          mode === 'timeout' ? AbortSignal.timeout(40) : controller.signal;
        let iterator: Iterator<unknown> | undefined;
        const operation = history.summarizeOldHistory(
          1,
          async (source, activeSignal) => {
            expect(activeSignal).toBe(signal);
            iterator = source[Symbol.iterator]();
            iterator.next();
            entered.resolve();
            await late.promise;
            return summaryRow();
          },
          signal,
        );
        await entered.promise;
        if (mode === 'abort') controller.abort(new Error('summary aborted'));
        await expect(operation).rejects.toThrow(
          mode === 'abort' ? 'summary aborted' : /timed out/i,
        );
        expect(iterator?.next().done).toBe(true);
        await unchanged(history, 3);
        assertOwnerBound(owners);
        late.resolve();
        await new Promise<void>((resolve) => setImmediate(resolve));
        await unchanged(history, 3);
        await history.summarizeOldHistory(2, async () => summaryRow());
        expect(history.length()).toBe(3);
      });
    },
  );
});

describe('summary publication rollback', () => {
  it('compensates partial journal admission and restores token and chronology state', async () => {
    await withBatchFixture(async ({ history, recorder, owners }) => {
      await seedRows(recorder, 5);
      await history.recalculateTokens();
      const before = await history.estimateTokensForContents(
        Array.from({ length: 5 }, (_, index) => exportSummaryRow(index)),
      );
      const summary = summaryRow();
      recorder.failAdmissionAfter(2);
      await expect(
        history.summarizeOldHistory(3, async () => summary),
      ).rejects.toThrow('injected journal admission failure');
      await unchanged(history, 5);
      expect(history.getTotalTokens()).toBe(before);
      expect(summary.metadata?.chronology).toBeUndefined();
      assertOwnerBound(owners);
    });
  });
});

describe('pending summary identity rollback', () => {
  it('restores pending row identities and markers before replaying a queued add on token failure', async () => {
    await withBatchFixture(
      async ({ history, pauseWriter, releaseWriter, owners }) => {
        pauseWriter();
        const originals = Array.from({ length: 5 }, (_, index) =>
          exportSummaryRow(index),
        );
        await history.addBatch(originals);
        const before = history.getTotalTokens();
        const entered = batchGate();
        const release = batchGate();
        history.setTokenizerFactory({
          ...exactTokenizer(),
          getTokenizer: () => ({
            fallbackPolicy: 'deny',
            countTokens: async () => {
              entered.resolve();
              await release.promise;
              throw new Error('summary tokenizer rejected');
            },
          }),
        });
        const operation = history.summarizeOldHistory(3, async (source) => {
          let index = 0;
          for (const row of source) {
            expect(row).toBe(originals[index]);
            index++;
          }
          return summaryRow();
        });
        await entered.promise;
        const queued = exportSummaryRow(5);
        history.add(queued);
        history.setTokenizerFactory(exactTokenizer());
        release.resolve();
        await expect(operation).rejects.toThrow('summary tokenizer rejected');
        const rows = await collectRawHistory(history);
        expect(rows).toHaveLength(6);
        originals.forEach((row, index) => {
          expect(rows[index]).toBe(row);
          expect(rows[index].metadata?.chronology).toBe(
            row.metadata?.chronology,
          );
        });
        expect(rows[5]).toBe(queued);
        await history.waitForTokenUpdates();
        expect(history.getTotalTokens()).toBe(
          before + (await history.estimateTokensForContents([queued])),
        );
        releaseWriter();
        await history.waitForCommit();
        assertOwnerBound(owners);
      },
    );
  });

  it('rolls back observer failure and permits a subsequent successful summary', async () => {
    await withBatchFixture(async ({ history, recorder, owners }) => {
      await seedRows(recorder, 5);
      await history.recalculateTokens();
      const before = await history.estimateTokensForContents(
        Array.from({ length: 5 }, (_, index) => exportSummaryRow(index)),
      );
      history.once('tokensUpdated', () => {
        throw new Error('summary observer rejected');
      });
      await expect(
        history.summarizeOldHistory(3, async () => summaryRow()),
      ).rejects.toThrow('summary observer rejected');
      await unchanged(history, 5);
      expect(history.getTotalTokens()).toBe(before);
      await history.summarizeOldHistory(3, async () => summaryRow());
      expect(history.length()).toBe(4);
      assertOwnerBound(owners);
    });
  });
});
