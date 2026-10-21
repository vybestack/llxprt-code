/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { historyOriginId } from '@vybestack/llxprt-code-core/services/history/historyOriginId.js';
import { exactTokenizer } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';

function row(index: number): IContent {
  if (index === 1)
    return {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aW1hZ2U=',
        },
      ],
    };
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `owned ${index}` }],
  };
}

async function origins(
  history: HistoryService,
): Promise<Array<string | undefined>> {
  return history.detachedValues.host().journal.readRows(async (view) => {
    const result: Array<string | undefined> = [];
    for (let index = 0; index < view.length; index++)
      result.push(await view.originAt(index));
    return result;
  });
}

describe('native semantic purge current source ownership', () => {
  for (const size of [3, 64, 65, 5000]) {
    it(`preserves current owned and unowned source rows after a removed row at ${size}`, async () => {
      const history = new HistoryService({ backend: 'journal' });
      history.setTokenizerFactory(exactTokenizer());
      const a = {};
      const b = {};
      const owner = (index: number): object | undefined => {
        if (index % 3 === 0) return undefined;
        return index % 3 === 1 ? a : b;
      };
      try {
        for (let index = 0; index < size; index++)
          history.add(row(index), undefined, owner(index));
        await history.waitForCommit();
        const before = Array.from({ length: size }, (_, index) => {
          const origin = owner(index);
          return origin === undefined ? undefined : historyOriginId(origin);
        });
        expect(await origins(history)).toStrictEqual(before);
        const session = new SemanticMediaPurgeSession({
          history,
          mode: () => 'remove',
          persist: async () => undefined,
        });
        const receipt = await operationFileCreates(async () => {
          const attempt = await session.begin(false);
          if (attempt === undefined) throw new Error('Missing owned purge');
          try {
            expect(
              await attempt.complete({
                status: 'success',
                usage: undefined,
                retryHandoff: false,
              }),
            ).toBe(true);
            expect(await origins(history)).toStrictEqual(
              before.filter((_, index) => index !== 1),
            );
            await attempt.rollbackCommitted();
            expect(await origins(history)).toStrictEqual(before);
          } finally {
            await attempt.finalize();
          }
        }, true);
        expect(receipt).toStrictEqual({ directories: [], files: [] });
        await history.clear();
        expect(await origins(history)).toStrictEqual([]);
        await history.clear();
        expect(await origins(history)).toStrictEqual([]);
      } finally {
        await history.dispose();
      }
    });
  }
});
