/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { observeHistorySynchronouslyForTest as testHistory } from '../../test-utils/synchronous-history-test-observation.js';
import { describe, expect, it } from 'bun:test';
import { collectRawHistory } from '../../test-utils/collect-raw-history.js';
import { HistoryService } from './HistoryService.js';
import {
  batchGate,
  batchRow,
  withBatchFixture,
} from './addbatch-stream-test-helpers.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';
import { repairRow, replacementFor } from './tool-repair-disk-test-helpers.js';
import type { IContent } from './IContent.js';

describe('disk repair edge contracts', () => {
  it('leaves the returned full-history array unchanged while repairing history membership', async () => {
    const history = new HistoryService();
    history.setTokenizerFactory(exactTokenizer());
    try {
      const input = repairRow(0, 3);
      history.add(input);
      const projection = testHistory(history);
      history.validateAndFix();
      expect(projection).toHaveLength(1);
      expect(projection[0]).toBe(input);
      expect(history.length()).toBe(2);
      await history.waitForTokenUpdates();
    } finally {
      history.dispose();
    }
  });

  it('repairs unmarked empty and mixed-role fixture rows without filtering original membership', async () => {
    await withBatchFixture(async ({ history, recorder }) => {
      const rows: IContent[] = [
        { speaker: 'ai', blocks: [] },
        {
          speaker: 'tool',
          blocks: [
            { type: 'tool_call', id: 'not-ai', name: 'skip', parameters: {} },
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: '', name: '', parameters: {} },
            { type: 'tool_call', id: 'answered', name: 'tool', parameters: {} },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'answered',
              toolName: 'tool',
              result: 1,
            },
            {
              type: 'tool_response',
              callId: '',
              toolName: 'empty-id',
              result: 2,
            },
          ],
        },
      ];
      for (const content of rows) await recorder.commit('content', { content });
      history.validateAndFix();
      await history.waitForTokenUpdates();
      const actual = await collectRawHistory(history);
      expect(
        actual.filter((row) => row.metadata?.synthetic !== true),
      ).toStrictEqual(rows);
      expect(actual[3].blocks).toStrictEqual([
        {
          type: 'tool_response',
          callId: '',
          toolName: 'unknown_tool',
          result: null,
          error: 'Tool call interrupted or cancelled',
          isComplete: true,
        },
      ]);
      expect(actual).toHaveLength(rows.length + 1);
    });
  });
});

describe('disk repair large-row and cancellation contracts', () => {
  it('accepts a valid row larger than eight MiB in both replacement and repair', async () => {
    await withBatchFixture(async ({ history, recorder }) => {
      const row = repairRow(0, 3);
      const large: IContent = {
        ...row,
        blocks: [
          ...row.blocks,
          { type: 'text', text: 'L'.repeat(9 * 1024 * 1024) },
        ],
      };
      await recorder.commit('content', { content: large });
      expect(
        await history.replaceToolResponseBlock(0, 2, replacementFor(0)),
      ).toBe(true);
      history.validateAndFix();
      await history.waitForTokenUpdates();
      const cursor = history.streamRawHistory();
      const first = await cursor.next();
      if (first.done === true) throw new Error('Missing large repaired row');
      expect(first.value.blocks[first.value.blocks.length - 1]).toStrictEqual(
        large.blocks[large.blocks.length - 1],
      );
      let count = 1;
      for await (const content of cursor) {
        void content;
        count++;
      }
      expect(count).toBe(2);
    });
  }, 180000);

  it('cancels a pending replacement before a queued writer appends and restores token state', async () => {
    await withBatchFixture(async ({ history, pauseWriter, releaseWriter }) => {
      pauseWriter();
      await history.addBatch([repairRow(0, 3)]);
      const before = history.getTotalTokens();
      const entered = batchGate();
      const release = batchGate();
      const controller = new AbortController();
      let first = true;
      history.setTokenizerFactory({
        ...exactTokenizer(),
        getTokenizer: () => ({
          fallbackPolicy: 'deny',
          countTokens: async () => {
            if (first) {
              first = false;
              entered.resolve();
              await release.promise;
            }
            return 1;
          },
        }),
      });
      const replacing = history.replaceToolResponseBlock(
        0,
        2,
        replacementFor(0),
        undefined,
        controller.signal,
      );
      await entered.promise;
      history.add(batchRow(1));
      controller.abort(new Error('cancel tool rewrite'));
      release.resolve();
      await expect(replacing).rejects.toThrow('cancel tool rewrite');
      await history.waitForTokenUpdates();
      expect((await collectRawHistory(history))[0].blocks[2]).toStrictEqual(
        repairRow(0, 3).blocks[2],
      );
      expect(history.getTotalTokens()).toBe(
        before + (await history.estimateTokensForContents([batchRow(1)])),
      );
      releaseWriter();
    });
  });
});

describe('disk replacement malformed external blocks', () => {
  it('rejects a null persisted target block without changing history', async () => {
    await withBatchFixture(async ({ history, recorder }) => {
      const input = repairRow(0, 3);
      Reflect.set(input.blocks, 2, null);
      await recorder.commit('content', { content: input });
      expect(
        await history.replaceToolResponseBlock(0, 2, replacementFor(0)),
      ).toBe(false);
      expect((await collectRawHistory(history))[0]).toStrictEqual(input);
    });
  });
});

describe('disk replacement no-op token isolation', () => {
  it('returns false for an invalid target without consuming an earlier token failure', async () => {
    await withBatchFixture(async ({ history, pauseWriter, releaseWriter }) => {
      pauseWriter();
      history.setTokenizerFactory(
        exactTokenizer(() => {
          throw new Error('earlier token failure');
        }),
      );
      history.add(batchRow(0));
      await expect(
        history.replaceToolResponseBlock(-1, 2, replacementFor(0)),
      ).resolves.toBe(false);
      await expect(history.waitForTokenUpdates()).rejects.toThrow(
        'earlier token failure',
      );
      releaseWriter();
    });
  });
});
