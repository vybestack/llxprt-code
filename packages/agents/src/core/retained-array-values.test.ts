/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withDetachedFixture } from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import { withRetainedClient } from './retained-array-test-helpers.js';
import {
  clientArrayRows,
  forbidClientArrayRollback,
} from './client-array-test-helpers.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';

describe('retained array stamped values', () => {
  it('preserves frozen stamped aliases and provenance without retaining marker identity', async () => {
    await withDetachedFixture((fixture) =>
      withRetainedClient(fixture, async ({ client }) => {
        forbidClientArrayRollback(fixture);
        const source = clientArrayRows(1)[0];
        const row: IContent = {
          ...source,
          speaker: 'ai',
          metadata: {
            ...source.metadata,
            model: 'saved-model',
            providerBaseURL: 'https://saved-provider.test',
          },
        };
        Object.freeze(row.metadata?.chronology);
        Object.freeze(row.metadata);
        Object.freeze(row);
        await client.storeHistoryForLaterUse([row, row]);
        const cursor = client.streamHistory();
        try {
          for (let index = 0; index < 2; index++) {
            const next = await cursor.next();
            if (next.done === true) throw new Error('Lost repeated alias');
            expect(next.value.metadata?.chronology).toStrictEqual(
              row.metadata?.chronology,
            );
            expect(next.value.metadata?.chronology).not.toBe(
              row.metadata?.chronology,
            );
            expect(next.value.metadata?.model).toBe('saved-model');
            expect(next.value.metadata?.providerBaseURL).toBe(
              'https://saved-provider.test',
            );
          }
          expect((await cursor.next()).done).toBe(true);
        } finally {
          await cursor.return();
        }
      }),
    );
  });
});
describe('retained array unsigned values', () => {
  it('strips only thought signatures before inactive publication and does not stamp fresh AI model provenance', async () => {
    await withDetachedFixture((fixture) =>
      withRetainedClient(fixture, async ({ client }) => {
        forbidClientArrayRollback(fixture);
        const row: IContent = {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'saved reasoning',
              signature: 'signature',
            },
            { type: 'text', text: 'answer' },
          ],
        };
        await client.setHistory([row], { stripThoughts: true });
        const cursor = client.streamHistory();
        try {
          const next = await cursor.next();
          if (next.done === true) throw new Error('Lost unsigned row');
          expect(next.value.blocks).toStrictEqual([
            { type: 'thinking', thought: 'saved reasoning' },
            { type: 'text', text: 'answer' },
          ]);
          expect(next.value.metadata?.model).toBeUndefined();
          expect(next.value.metadata?.chronology?.seq).toBe(1);
          expect(row).toStrictEqual({
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: 'saved reasoning',
                signature: 'signature',
              },
              { type: 'text', text: 'answer' },
            ],
          });
        } finally {
          await cursor.return();
        }
        await client.storeHistoryForLaterUse([]);
        expect((await client.streamHistory().next()).done).toBe(true);
      }),
    );
  });
});

describe('detached deferred startup extras', () => {
  it('loads explicit additional rows once after empty deferred array admission', async () => {
    await withDetachedFixture((fixture) =>
      withRetainedClient(fixture, async ({ client }) => {
        await client.storeHistoryForLaterUse([]);
        await client.startChat([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'explicit extra row' }],
          },
        ]);
        const blocks = [];
        for await (const row of client.streamHistory()) blocks.push(row.blocks);
        expect(blocks).toStrictEqual([
          [{ type: 'text', text: 'explicit extra row' }],
        ]);
      }),
    );
  });
});
