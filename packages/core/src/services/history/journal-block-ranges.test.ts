/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from './journalSession.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { response } from './__tests__/support/normalization-cases.js';
import { decodeStoredBlock, decodeStoredRow } from './journalRowCodec.js';

const decoder = new TextDecoder();

describe('native row block and metadata range reads', () => {
  const directory = useTempDir('journal-block-ranges-');
  it('reads a relocated response and metadata without reading unrelated row text', async () => {
    const lengths: number[] = [];
    const base = testJournalSeams({}, 1, false).dependencies;
    const session = await JournalSession.create(`${directory()}/ranges.llxj`, {
      journal: {
        ...base,
        open: async (path, flags) => {
          const handle = await base.open(path, flags);
          return {
            ...handle,
            read: async (buffer, offset, length, position) => {
              lengths.push(length);
              return handle.read(buffer, offset, length, position);
            },
          };
        },
      },
    });
    try {
      await session.append([
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'unrelated'.repeat(262144) },
            response('a'),
          ],
          metadata: { model: 'source' },
        },
      ]);
      const snapshot = await session.store.snapshot();
      try {
        const entry = await snapshot.entryAt(0);
        lengths.length = 0;
        const block = await snapshot.readBlock(entry, 1);
        const meta = await snapshot.readMetadata(entry);
        expect({
          block: JSON.parse(decoder.decode(block)),
          meta: decodeStoredRow(meta),
        }).toStrictEqual({
          block: response('a'),
          meta: { speaker: 'human', blocks: [], metadata: { model: 'source' } },
        });
        expect(Math.max(...lengths)).toBeLessThan(65536);
        expect(decodeStoredBlock(block, 2)).toStrictEqual(response('a'));
        await expect(snapshot.readBlock(entry, 2)).rejects.toThrow('block');
        await expect(snapshot.readBlock(entry, -1)).rejects.toThrow('block');
        await expect(snapshot.readBlock(entry, 0.5)).rejects.toThrow('block');
      } finally {
        await snapshot.close();
      }
      const closed = await session.store.snapshot();
      const entry = await closed.entryAt(0);
      await closed.close();
      await expect(closed.readBlock(entry, 1)).rejects.toThrow(
        'pin was released',
      );
    } finally {
      await session.close();
    }
  });
});
