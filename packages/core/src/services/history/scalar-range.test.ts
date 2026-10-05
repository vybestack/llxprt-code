/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow, withBatchFixture } from './addbatch-stream-test-helpers.js';
import type { IContent } from './IContent.js';

function summaryRow(
  index: number,
  seq: number,
  fromSeq: number,
  toSeq: number,
): IContent {
  return {
    ...batchRow(index),
    metadata: {
      chronology: { seq, userTurn: 1, step: 0, recordedAt: 1700000000000 },
      chronologyReplaced: { fromSeq, toSeq, itemCount: toSeq - fromSeq + 1 },
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    },
  };
}

describe('scalar chronology and filter semantics', () => {
  it.each([false, true])(
    'uses positional boundaries and omits derived summary spans only for legacy membership=%s',
    async (legacy) => {
      await withBatchFixture(async ({ history, recorder }) => {
        const first = summaryRow(0, 41, 10, 14);
        const second: IContent = legacy
          ? {
              ...batchRow(1),
              metadata: {
                usage: {
                  totalTokens: Infinity,
                  promptTokens: 0,
                  completionTokens: 0,
                },
              },
            }
          : summaryRow(1, 2, 13, 16);
        const third = summaryRow(2, 3, 30, 31);
        for (const content of [first, second, third])
          await recorder.commit('content', { content });
        expect(history.getContextRange()).toStrictEqual({
          firstSeq: 41,
          lastSeq: 3,
          totalEntries: 3,
          approximate: legacy,
          removedInterior: legacy
            ? []
            : [
                { start: 10, end: 16, reason: 'compressed' },
                { start: 30, end: 31, reason: 'compressed' },
              ],
        });
        expect(history.getStatistics()).toStrictEqual({
          totalMessages: 3,
          userMessages: 1,
          aiMessages: 1,
          toolCalls: 3,
          toolResponses: 3,
          totalTokens: legacy ? 10 : 15,
        });
        expect(history.getLastUserContent()).toStrictEqual(first);
        expect(history.getLastAIContent()?.metadata?.chronology?.seq).toBe(
          legacy ? undefined : 2,
        );
      });
    },
  );
});
