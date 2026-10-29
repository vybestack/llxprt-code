/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { openOwnedJournal } from './journalOwnedFixture.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { snapshotReferences } from './journalMediaReferences.js';

describe('native compensation media references', () => {
  const directory = useTempDir('snapshot-media-blocks-');
  it('reads only declared media blocks instead of decoding large text during compensation', async () => {
    const media = new LocalMediaStore({
      rootDirectory: `${directory()}/media`,
      quotaBytes: 4096,
    });
    const reference = await media.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const journal = await openOwnedJournal(`${directory()}/source.llxj`, [
      {
        content: {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'x'.repeat(9 * 1024 * 1024 + 17) },
            reference,
          ],
        },
      },
      {
        content: {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'no media' }],
        },
      },
      { content: { speaker: 'human', blocks: [reference] } },
    ]);
    const snapshot = await journal.session.store.snapshot();
    const decode = spyOn(snapshot, 'readRow').mockImplementation(async () => {
      throw new Error('Whole text row decoded for media snapshot');
    });
    const readBlock = snapshot.readBlock.bind(snapshot);
    const selected: number[] = [];
    const blocks = spyOn(snapshot, 'readBlock').mockImplementation(
      async (entry, index) => {
        selected.push(index);
        return readBlock(entry, index);
      },
    );
    try {
      const references = [];
      for await (const value of snapshotReferences(snapshot))
        references.push(value);
      expect(references).toStrictEqual([reference, reference]);
      expect(selected).toStrictEqual([1, 0]);
    } finally {
      decode.mockRestore();
      blocks.mockRestore();
      await snapshot.close();
      await journal.dispose();
    }
  });
});
