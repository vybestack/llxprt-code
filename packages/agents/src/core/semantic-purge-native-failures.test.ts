/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { exactTokenizer } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
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
          data: 'aQ==',
        },
      ],
    };
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `failure value ${index}` }],
  };
}
async function collect(rows: AsyncIterable<IContent>): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const value of rows) result.push(value);
  return result;
}
const success = { status: 'success', cachePrefixWritten: true } as const;

async function continueWriter(
  coordinator: SemanticMediaPurgeStreamCoordinator,
): Promise<void> {
  const next = await coordinator.begin({ mode: 'remove' });
  if (next === undefined) throw new Error('Missing continuation');
  try {
    expect(await coordinator.commit(next, success)).toBe(true);
    await coordinator.rollback(next);
  } finally {
    await next.close();
  }
}

describe('native semantic purge failures', () => {
  for (const stage of ['producer', 'query', 'abort']) {
    it(`preserves prior roots and original error identity for ${stage} failure at row 65`, async () => {
      const history = new HistoryService({});
      history.setTokenizerFactory(exactTokenizer());
      try {
        await history.detachedValues.replace(
          Array.from({ length: 130 }, (_, index) => row(index)),
        );
        const before = await collect(history.streamRawHistory());
        const tokens = history.getTotalTokens();
        const old = await history.openDumpSnapshot();
        let persisted = JSON.stringify(before);
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
          persist: async (rows) => {
            persisted = JSON.stringify(await collect(rows.streamRows()));
          },
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (transaction === undefined)
          throw new Error('Missing failure transaction');
        const reason = new Error(`native purge ${stage}`);
        const controller = new AbortController();
        let converted = 0;
        let queries = 0;
        const estimate = history.estimateTokensForContents.bind(history);
        const read = JournalDumpSnapshot.prototype.readRawRow;
        const producer = spyOn(
          history,
          'estimateTokensForContents',
        ).mockImplementation(async (...args) => {
          converted++;
          if (converted === 65 && stage === 'producer') throw reason;
          if (converted === 65 && stage === 'abort') controller.abort(reason);
          return estimate(...args);
        });
        const query = spyOn(
          JournalDumpSnapshot.prototype,
          'readRawRow',
        ).mockImplementation(function (this: JournalDumpSnapshot, index) {
          if (++queries === 65 && stage === 'query')
            return Promise.reject(reason);
          return read.call(this, index);
        });
        try {
          await expect(
            coordinator.commit(transaction, success, controller.signal),
          ).rejects.toBe(reason);
          expect(await collect(history.streamRawHistory())).toStrictEqual(
            before,
          );
          expect(history.getTotalTokens()).toBe(tokens);
          expect(persisted).toBe(JSON.stringify(before));
          expect(await collect(old.rows())).toStrictEqual(before);
        } finally {
          producer.mockRestore();
          query.mockRestore();
          await transaction.close();
        }
        try {
          const receipt = await operationFileCreates(
            () => continueWriter(coordinator),
            true,
          );
          expect(receipt).toStrictEqual({ directories: [], files: [] });
          expect(await collect(history.streamRawHistory())).toStrictEqual(
            before,
          );
        } finally {
          await old.close();
        }
      } finally {
        await history.dispose();
      }
    });
  }
});
