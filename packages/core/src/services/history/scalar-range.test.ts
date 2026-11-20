/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { batchRow } from './__tests__/support/addbatch-stream-test-helpers.js';
import {
  createRecorderForTest,
  recordRowsForTest,
} from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { requireJournalRecorder } from './recorderBackend.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
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
  const directory = useTempDir('scalar-range-');
  it.each([false, true])(
    'uses positional boundaries and omits derived summary spans only for legacy membership=%s',
    async (legacy) => {
      const recorder = createRecorderForTest({ chatsDir: directory() });
      const history = new JournalHistoryStore(
        await requireJournalRecorder(recorder).session(),
      );
      try {
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
        await recordRowsForTest(recorder, [first, second, third]);
        await history.waitForCommit();
        expect(history.contextRange([])).toStrictEqual({
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
        expect(history.statistics()).toStrictEqual({
          totalMessages: 3,
          userMessages: 1,
          aiMessages: 1,
          toolCalls: 3,
          toolResponses: 3,
        });
        expect(await history.lastContent('human')).toStrictEqual(first);
        expect(
          (await history.lastContent('ai'))?.metadata?.chronology?.seq,
        ).toBe(legacy ? undefined : 2);
      } finally {
        await history.dispose();
        await recorder.dispose();
      }
    },
  );
});
