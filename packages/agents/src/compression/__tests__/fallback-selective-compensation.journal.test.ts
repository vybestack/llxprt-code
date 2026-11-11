/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createUserMessage } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { executeFallbackTransaction } from '../providerFallbackTransaction.js';

async function texts(history: HistoryService): Promise<string[]> {
  const values: string[] = [];
  for await (const row of history.streamRawHistory())
    for (const block of row.blocks)
      if (block.type === 'text') values.push(block.text);
  return values;
}

describe('rejected journal fallback compensation', () => {
  it.each(['reject', 'throw', 'abort'])(
    'keeps independent appends after %s',
    async (mode) => {
      const history = new HistoryService();
      try {
        await history.addBatch([createUserMessage('original')]);
        history.setCacheAnchorSeq(1);
        let baseline: number | null = 123;
        const abort = new DOMException('cancelled', 'AbortError');
        const work = executeFallbackTransaction(
          {
            historyService: history,
            logger: new DebugLogger('test:fallback-selective'),
            model: 'test',
            getPromptTokenBaseline: () => baseline,
            resetPromptTokenBaseline: () => {
              baseline = null;
            },
            restorePromptTokenBaseline: (value) => {
              baseline = value;
            },
            performFallbackCompression: async (_prompt, install) => {
              const row = createUserMessage('partial');
              await install({
                rows: {
                  length: 1,
                  readRow: () => row,
                  *[Symbol.iterator]() {
                    yield row;
                  },
                },
                start: 0,
                hasPendingRows: false,
              });
              await history.addBatch([createUserMessage('independent')]);
              if (mode === 'throw') throw new Error('fallback rejected');
              if (mode === 'abort') throw abort;
              return false;
            },
          },
          'test',
          undefined,
        );
        const result = await work.then(
          (outcome) => ({
            applied: outcome.truncationApplied,
            failure: outcome.truncationFailure,
            cancelled: false,
          }),
          (error: unknown) => ({
            applied: false,
            failure: error,
            cancelled: error === abort,
          }),
        );
        expect(result.applied).toBe(false);
        expect(result.failure).toBeInstanceOf(Error);
        expect(result.cancelled).toBe(mode === 'abort');
        expect(await texts(history)).toStrictEqual(['original', 'independent']);
        expect(history.getCacheAnchorSeq()).toBe(1);
        expect(baseline).toBe(123);
      } finally {
        await history.dispose();
      }
    },
  );
});
