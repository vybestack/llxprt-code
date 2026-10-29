/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

/** The dump reports the rows it decodes to the read counters and releases them when its reader lets go (WIRING G9). */
describe('journal dump snapshot row accounting', () => {
  const directory = useTempDir('journal-dump-counters-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  async function storeWithRows(count: number) {
    const ownership = new RowOwnership();
    const counters = createRowCounters();
    const session = await JournalSession.create(
      path.join(directory(), 'dump.llxj'),
      { journal: testJournalSeams({}).dependencies },
    );
    const store = new JournalHistoryStore(session, {
      counters: { ...counters.counters, ownership },
    });
    open.push(store);
    for (let index = 0; index < count; index++)
      store.apply({
        kind: 'content',
        content: {
          speaker: 'human',
          blocks: [{ type: 'text', text: `row-${index}` }],
        },
      });
    return { store, ownership };
  }

  it('holds the row a reader is suspended on until the reader moves on', async () => {
    const { store, ownership } = await storeWithRows(2);
    const dump = await store.openDumpSnapshot();
    try {
      const reader = dump.rows()[Symbol.asyncIterator]();
      await reader.next();
      expect(ownership.snapshot().liveRows).toBe(1);
      await reader.next();
      expect(ownership.snapshot().liveRows).toBe(1);
      expect((await reader.next()).done).toBe(true);
      expect(ownership.snapshot().liveRows).toBe(0);
    } finally {
      await dump.close();
    }
  });

  it('releases a suspended reader at close, which then fails, and refuses a new pass', async () => {
    const { store, ownership } = await storeWithRows(2);
    const dump = await store.openDumpSnapshot();
    const reader = dump.rows()[Symbol.asyncIterator]();
    await reader.next();
    expect(ownership.snapshot().liveRows).toBe(1);

    await dump.close();

    expect(ownership.snapshot().liveRows).toBe(0);
    await expect(reader.next()).rejects.toThrow('closed');
    expect(ownership.snapshot().liveRows).toBe(0);
    await expect(
      (async () => {
        for await (const value of dump.rows()) void value;
      })(),
    ).rejects.toThrow('closed');
  });
});
