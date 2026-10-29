/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';

const ROW_TEXT_BYTES = 6 * 1024 * 1024;

describe('journal row reads', () => {
  const directory = useTempDir('journal-row-read-');
  let session: JournalSession | undefined;
  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  it('reads a row body into one buffer, never gathering chunks and joining them', async () => {
    session = await JournalSession.create(path.join(directory(), 'row.llxj'), {
      journal: testJournalSeams().dependencies,
    });
    const text = 'x'.repeat(ROW_TEXT_BYTES);
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text }] },
    ]);
    const entry = await session.store.rows().next();
    if (entry.done === true) throw new Error('The journal holds no row');

    const concat = spyOn(Buffer, 'concat');
    try {
      const stored = await session.store.readRow(entry.value);
      expect(stored.blocks[0].length).toBeGreaterThan(ROW_TEXT_BYTES);
      const joined = concat.mock.results.filter(
        (result) => (result.value as Uint8Array).length >= ROW_TEXT_BYTES,
      );
      expect(joined).toHaveLength(0);
    } finally {
      concat.mockRestore();
    }
  });
});
