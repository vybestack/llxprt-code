/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  exactTokenizer,
  mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

describe('density chronology rollback before the batch commit', () => {
  for (const stage of ['tokenizer', 'prepare']) {
    it(`restores the replacement's original marker identity after ${stage} failure`, async () => {
      await withRollbackFixture(async (history) => {
        const baseline = [rollbackRow(0), rollbackRow(1), rollbackRow(2)];
        for (const row of baseline) history.add(row);
        await history.waitForCommit();
        const stored = baseline;
        expect(
          stored.map((row) => row.metadata?.chronology?.seq),
        ).toStrictEqual([1, 2, 3]);
        expect(stored.map((row) => row.blocks)).toStrictEqual([
          rollbackRow(0).blocks,
          rollbackRow(1).blocks,
          rollbackRow(2).blocks,
        ]);
        const marker = { seq: 700, userTurn: 90, step: 3, recordedAt: 0 };
        const replacement = {
          ...rollbackRow(3),
          metadata: { chronology: marker },
        };
        const failure = new Error(`density ${stage} failure`);
        const fail = (): never => {
          throw failure;
        };
        if (stage === 'tokenizer')
          history.setTokenizerFactory(exactTokenizer(fail));
        else history.registerMediaOwner(mediaParticipant(fail));
        const error = await rejectedValue(
          history.applyDensityResult({
            removals: [2],
            replacements: new Map([[1, replacement]]),
            metadata: {
              readWritePairsPruned: 0,
              fileDeduplicationsPruned: 0,
              recencyPruned: 1,
            },
          }),
        );
        expect(error).toBe(failure);
        expect(await rowsOf(history)).toStrictEqual(stored);
        expect(history.getTotalTokens()).toBe(12);
        expect(replacement.metadata.chronology).toBe(marker);
      });
    });
  }
});
