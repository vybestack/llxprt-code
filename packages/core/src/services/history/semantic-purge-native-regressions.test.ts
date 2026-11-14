/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativePurgeFixture } from './__tests__/support/native-purge-fixture.js';
import { SemanticMediaPurgeStreamCoordinator } from './semantic-purge-stream.js';
import { selectNativeSemanticPurge } from './semantic-purge-native.js';
import type { IContent } from './IContent.js';
import type { ProviderSnapshotOpener } from './native-purge-provider-request.js';

async function hasKimiFacts(open: ProviderSnapshotOpener): Promise<boolean> {
  const request = await open([], {});
  try {
    if (request.native === undefined) throw new Error('Missing native');
    return await request.native.withKimi((pin) => pin.hasKimiFacts());
  } finally {
    await request.close();
  }
}

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
    const selection = await selectNativeSemanticPurge(
      {
        length: rows.length,
        async *streamRows() {
          yield* rows;
        },
        readRow: async (index) => rows[index],
        isCurrent: () => true,
        restore: async () => {},
        close: async () => {},
      },
      { mode: 'remove' },
    );
    if (selection === undefined) throw new Error('Missing purge');
    try {
      const candidate = await collect(selection.candidate.streamRows());
      expect(candidate.map((row) => [row.speaker, row.blocks])).toStrictEqual([
        ['ai', []],
        ['human', [{ type: 'text', text: 'after' }]],
      ]);
    } finally {
      await selection.candidate.close();
    }
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
          expect(await hasKimiFacts(open)).toBe(true);
        }
      } finally {
        await transaction.close();
      }
    });
  });
});
