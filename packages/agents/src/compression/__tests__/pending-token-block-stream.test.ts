/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { estimateSourcePendingTokens } from '../compressionBudgeting.js';

describe('pending native token blocks', () => {
  it('matches the whole-row count without opening the row-hydrating reader', async () => {
    const history = new HistoryService();
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'first 雪 '.repeat(10000) },
          { type: 'text', text: 'second 😀 '.repeat(10000) },
        ],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_a',
            name: 'lookup',
            parameters: { query: 'snow' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_a',
            toolName: 'lookup',
            result: 'result '.repeat(10000),
          },
        ],
      },
    ];
    try {
      history.addAll(contents);
      await history.waitForTokenUpdates();
      const request = await history.prepareCuratedForProviderSnapshot();
      try {
        const original = { [Symbol.asyncIterator]: () => request.openReader() };
        const expected = await history.estimateTokensForContents(
          original,
          'test',
        );
        spyOn(request, 'openReader').mockImplementation(() => {
          throw new Error('whole-row reader');
        });
        expect(
          await estimateSourcePendingTokens(request, history, 'test'),
        ).toBe(expected);
      } finally {
        await request.close();
      }
    } finally {
      await history.dispose();
    }
  });
});
