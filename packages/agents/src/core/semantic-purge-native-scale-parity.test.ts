/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { historyOriginId } from '@vybestack/llxprt-code-core/services/history/historyOriginId.js';
import { describe, expect, it } from 'bun:test';
import { withNativePurgeFixture } from '../../../core/src/services/history/__tests__/support/native-purge-fixture.js';
import { expectedSemanticPurge } from './__tests__/support/semantic-purge-row-oracle.js';
import { exactTokenizer } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

function seededRows(size: number): IContent[] {
  return Array.from(
    { length: size },
    (_, index): IContent => ({
      speaker: index % 2 === 0 ? 'human' : 'ai',
      blocks:
        index === 1
          ? [
              {
                type: 'media',
                encoding: 'base64',
                mimeType: 'image/png',
                data: 'YQ==',
                caption: 'scale image',
              },
            ]
          : [{ type: 'text', text: `scale ${index}: 雪\\\n` }],
      metadata: {
        id: `scale-${index}`,
        responsesStored: index % 2 === 1,
        ...(index === 0 ? { cacheAnchor: true } : {}),
        ...(index === 3
          ? {
              isSummary: true,
              chronologyReplaced: { fromSeq: 2, toSeq: 2, itemCount: 1 },
            }
          : {}),
        chronology: {
          seq: index + 1,
          userTurn: index + 1,
          step: 1,
          recordedAt: index + 1,
        },
      },
    }),
  );
}

async function collect(rows: AsyncIterable<IContent>): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

describe('actual native purge independent scale parity below provider preparation', () => {
  for (const size of [65]) {
    it(`matches old eager tokens, full values, owners, events and durable mirrors at ${size}`, async () => {
      const input = seededRows(size);
      const eager = new HistoryService({});
      eager.setTokenizerFactory(exactTokenizer());
      try {
        await eager.detachedValues.replace(input);
        const expected = expectedSemanticPurge(input, 'remove');
        if (expected === undefined)
          throw new Error('Missing independent eager purge');
        const expectedEvents: unknown[] = [];
        eager.on('tokensUpdated', (event) =>
          expectedEvents.push({ type: 'tokens', event }),
        );
        eager.on('contextRangeChanged', (event) =>
          expectedEvents.push({ type: 'range', event }),
        );
        await eager.detachedValues.replace(expected);
        const expectedBytes = JSON.stringify(expected);
        const origin = {};
        await withNativePurgeFixture(async ({ history, assertDurable }) => {
          await history.detachedValues.replace(input, undefined, { origin });
          const events: unknown[] = [];
          history.on('tokensUpdated', (event) =>
            events.push({ type: 'tokens', event }),
          );
          history.on('contextRangeChanged', (event) =>
            events.push({ type: 'range', event }),
          );
          expect(history.getTotalTokens()).toBe(size + 1000);
          const session = new SemanticMediaPurgeSession({
            history,
            mode: () => 'remove',
            persist: async () => undefined,
          });
          const receipt = await operationFileCreates(async () => {
            const attempt = await session.begin(false);
            if (attempt === undefined)
              throw new Error('Missing scale native purge');
            try {
              expect(
                JSON.stringify(
                  await collect(attempt.candidateHistory.streamRows()),
                ),
              ).toBe(expectedBytes);
              expect(
                await attempt.complete({
                  status: 'success',
                  usage: undefined,
                  retryHandoff: false,
                }),
              ).toBe(true);
            } finally {
              await attempt.finalize();
            }
          }, true);
          expect(receipt).toStrictEqual({ directories: [], files: [] });
          expect(
            JSON.stringify(await collect(history.streamRawHistory())),
          ).toBe(expectedBytes);
          expect(history.getTotalTokens()).toBe(eager.getTotalTokens());
          await assertDurable(expected);
          await history.detachedValues.host().journal.readRows(async (view) => {
            const origins: Array<string | undefined> = [];
            for (let index = 0; index < view.length; index++)
              origins.push(await view.originAt(index));
            expect(origins).toStrictEqual(
              Array.from({ length: size - 1 }, () => historyOriginId(origin)),
            );
          });
          expect(events).toStrictEqual(expectedEvents);
          process.stdout.write(
            `PURGE_INDEPENDENT_PARITY ${JSON.stringify({ size, tokens: history.getTotalTokens(), expectedTokens: eager.getTotalTokens(), durableMirrors: 2 })}\n`,
          );
        }, origin);
      } finally {
        await eager.dispose();
      }
    });
  }
});
