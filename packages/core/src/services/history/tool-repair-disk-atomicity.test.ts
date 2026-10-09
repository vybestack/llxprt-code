/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import {
  withBatchFixture,
  batchGate,
  batchRow,
} from './addbatch-stream-test-helpers.js';
import { repairRow, replacementFor } from './tool-repair-disk-test-helpers.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';

describe('disk validation repair atomicity', () => {
  it('repairs synchronously and does not insert duplicate synthetic rows', async () => {
    await withBatchFixture(async ({ history, recorder }) => {
      await recorder.commit('content', { content: repairRow(0, 3) });
      history.validateAndFix();
      const afterFirstRepair = history.length();
      await history.waitForTokenUpdates();
      history.validateAndFix();
      expect([afterFirstRepair, history.length()]).toStrictEqual([2, 2]);
    });
  });

  it('restores multiple inserted rows on journal admission failure', async () => {
    await withBatchFixture(async ({ history, recorder, owners }) => {
      for (let i = 0; i < 3; i++)
        await recorder.commit('content', { content: repairRow(i, 3) });
      const before = Array.from({ length: 3 }, (_, index) =>
        repairRow(index, 3),
      );
      recorder.failAdmissionAfter(1);
      expect(() => history.validateAndFix()).toThrow(
        'injected journal admission failure',
      );
      expect(await collectRawHistory(history)).toStrictEqual(before);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('compensates a token observer rejection before replaying a queued append', async () => {
    await withBatchFixture(async ({ history, recorder }) => {
      await recorder.commit('content', { content: repairRow(0, 3) });
      await history.recalculateTokens();
      const before = history.getTotalTokens();
      let once = true;
      history.on('tokensUpdated', () => {
        if (!once) return;
        once = false;
        history.add(batchRow(10));
        throw new Error('repair observer rejection');
      });
      history.validateAndFix();
      await expect(history.waitForTokenUpdates()).rejects.toThrow(
        'repair observer rejection',
      );
      await history.waitForCommit();
      await history.waitForTokenUpdates();
      expect(
        (await collectRawHistory(history)).map((row) => row.blocks),
      ).toStrictEqual([repairRow(0, 3).blocks, batchRow(10).blocks]);
      expect(history.getTotalTokens()).toBe(
        before + (await history.estimateTokensForContents([batchRow(10)])),
      );
    });
  });
});

describe('disk tool replacement rollback', () => {
  it('restores addressed rows and source markers while a writer and tokenizer are paused', async () => {
    await withBatchFixture(async ({ history, pauseWriter, releaseWriter }) => {
      pauseWriter();
      const original = [repairRow(0, 3), batchRow(1), repairRow(2, 3)];
      await history.addBatch(original);
      const entered = batchGate();
      const release = batchGate();
      let first = true;
      history.setTokenizerFactory(exactTokenizer(() => {}));
      history.setTokenizerFactory({
        ...exactTokenizer(),
        getTokenizer: () => ({
          fallbackPolicy: 'deny',
          countTokens: async () => {
            if (first) {
              first = false;
              entered.resolve();
              await release.promise;
              throw new Error('replacement rejected');
            }
            return 1;
          },
        }),
      });
      const operation = history.replaceToolResponseBlock(
        0,
        2,
        replacementFor(0),
      );
      await entered.promise;
      const queued = batchRow(3);
      history.add(queued);
      release.resolve();
      await expect(operation).rejects.toThrow('replacement rejected');
      const rows = await collectRawHistory(history);
      expect(rows).toHaveLength(4);
      for (let index = 0; index < original.length; index++) {
        expect(rows[index]).toBe(original[index]);
        expect(rows[index].metadata?.chronology).toBe(
          original[index].metadata?.chronology,
        );
      }
      expect(rows[3]).toBe(queued);
      releaseWriter();
    });
  });
});
