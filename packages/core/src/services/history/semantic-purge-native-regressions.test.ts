/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { withNativePurgeFixture } from './__tests__/support/native-purge-fixture.js';
import { SemanticMediaPurgeStreamCoordinator } from './semantic-purge-stream.js';
import type { IContent } from './IContent.js';

async function collect(rows: AsyncIterable<IContent>): Promise<IContent[]> {
  const result: IContent[] = [];
  for await (const row of rows) result.push(row);
  return result;
}

describe('native semantic purge row preservation and facts', () => {
  it('preserves existing empty rows when removing an image elsewhere', async () => {
    const rows: readonly IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'AQ==',
          },
        ],
      },
      { speaker: 'ai', blocks: [] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'after' }] },
    ];
    await withSuffixFixture(
      3,
      async (history) => {
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (transaction === undefined) throw new Error('Missing purge');
        try {
          const rows = await collect(transaction.candidate.streamRows());
          expect(rows.map((row) => [row.speaker, row.blocks])).toStrictEqual([
            ['ai', []],
            ['human', [{ type: 'text', text: 'after' }]],
          ]);
        } finally {
          await transaction.close();
        }
      },
      0,
      (index) => rows[index],
    );
  });

  it('fills Kimi facts for both base and candidate request pins', async () => {
    await withNativePurgeFixture(async ({ history, store }) => {
      const image = await store.admit({
        bytes: new Uint8Array([2]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      await history.addBatch([
        { speaker: 'human', blocks: [{ type: 'text', text: 'before' }, image] },
      ]);
      const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: false,
      });
      const transaction = await coordinator.begin({ mode: 'remove' });
      if (transaction === undefined) throw new Error('Missing purge');
      try {
        for (const explicit of [true, false]) {
          const open = transaction.providerSnapshotOpener(explicit);
          if (open === undefined) throw new Error('Missing native opener');
          const request = await open([], {});
          try {
            if (request.native === undefined) throw new Error('Missing native');
            expect(
              await request.native.withKimi((pin) => pin.hasKimiFacts()),
            ).toBe(true);
          } finally {
            await request.close();
          }
        }
      } finally {
        await transaction.close();
      }
    });
  });
});
