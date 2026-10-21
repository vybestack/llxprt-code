/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { exactTokenizer } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';

function rows(): IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'before' }] },
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'aW1hZ2U=',
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'after' }],
      metadata: { responsesStored: true },
    },
  ];
}

async function collect(history: HistoryService): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of history.streamRawHistory()) result.push(row);
  return result;
}

describe('native public semantic purge producer', () => {
  for (const deny of [false, true]) {
    it(`purges and restores without scratch with creating APIs ${deny ? 'denied' : 'observed'}`, async () => {
      const history = new HistoryService({ backend: 'journal' });
      history.setTokenizerFactory(exactTokenizer());
      try {
        await history.detachedValues.replace(rows());
        const before = await collect(history);
        const tokens = history.getTotalTokens();
        const session = new SemanticMediaPurgeSession({
          history,
          mode: () => 'remove',
          persist: async () => undefined,
        });
        const receipt = await operationFileCreates(async () => {
          const attempt = await session.begin(false);
          if (attempt === undefined) throw new Error('Missing native purge');
          try {
            expect(
              await attempt.complete({
                status: 'success',
                usage: undefined,
                retryHandoff: false,
              }),
            ).toBe(true);
            const after = await collect(history);
            expect(after.map(({ blocks }) => blocks)).toStrictEqual([
              rows()[0].blocks,
              rows()[2].blocks,
            ]);
            expect(after[1].metadata?.responsesStored).toBeUndefined();
            await attempt.rollbackCommitted();
            expect(await collect(history)).toStrictEqual(before);
            expect(history.getTotalTokens()).toBe(tokens);
          } finally {
            await attempt.finalize();
          }
        }, deny);
        expect(receipt).toStrictEqual({ directories: [], files: [] });
      } finally {
        await history.dispose();
      }
    });
  }
});
