/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withBatchFixture } from './addbatch-stream-test-helpers.js';
import { exportSummaryRow, summaryRow } from './export-summary-test-helpers.js';
import { mediaParticipant } from './chronology-rollback-test-helpers.js';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';

describe('summary cancellation before journal publication', () => {
  it('never opens callback rows when already aborted', async () => {
    await withBatchFixture(async ({ history }) => {
      history.add(exportSummaryRow(0));
      const controller = new AbortController();
      controller.abort(new Error('pre-aborted summary'));
      await expect(
        history.summarizeOldHistory(
          0,
          async () => {
            throw new Error('callback reached');
          },
          controller.signal,
        ),
      ).rejects.toThrow('pre-aborted summary');
      expect(history.length()).toBe(1);
    });
  });

  it('restores media effects, tokens and row values if aborted after media publication', async () => {
    await withBatchFixture(async ({ history, owners }) => {
      const input = Array.from({ length: 5 }, (_, i) => exportSummaryRow(i));
      await history.addBatch(input);
      await history.waitForCommit();
      const controller = new AbortController();
      let publishedMedia = false;
      history.registerMediaOwner(
        mediaParticipant(async () => ({
          publish: async () => {
            publishedMedia = true;
            controller.abort(new Error('media cancelled summary'));
          },
          rollback: async () => {
            publishedMedia = false;
          },
        })),
      );
      const before = await history.estimateTokensForContents(input);
      const summary = summaryRow();
      await expect(
        history.summarizeOldHistory(3, async () => summary, controller.signal),
      ).rejects.toThrow('media cancelled summary');
      expect(publishedMedia).toBe(false);
      expect(history.getTotalTokens()).toBe(before);
      const restored = await collectRawHistory(history);
      expect(restored).toStrictEqual(input);
      restored.forEach((row, index) => expect(row).not.toBe(input[index]));
      expect(summary.metadata?.chronology).toBeUndefined();
      await history.waitForCommit();
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });
});
