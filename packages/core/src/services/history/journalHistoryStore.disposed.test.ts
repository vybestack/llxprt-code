/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

/**
 * A read of a disposed store says that it is disposed. The journal file is
 * closed by then, so without the check a reader reaches the closed
 * descriptor and fails with "Bad file descriptor".
 */
describe('a disposed journal history store', () => {
  const directory = useTempDir('journal-store-disposed-');

  async function disposedStore(): Promise<JournalHistoryStore> {
    const session = await JournalSession.create(
      path.join(directory(), 'disposed.llxj'),
      { journal: testJournalSeams({}).dependencies },
    );
    const store = new JournalHistoryStore(session);
    store.apply({
      kind: 'content',
      content: { speaker: 'human', blocks: [{ type: 'text', text: 'row' }] },
    });
    await store.dispose();
    return store;
  }

  it('refuses a row stream', async () => {
    const store = await disposedStore();
    await expect(store.streamRows().next()).rejects.toThrow('disposed');
  });

  it('refuses a dump snapshot', async () => {
    const store = await disposedStore();
    await expect(store.openDumpSnapshot()).rejects.toThrow('disposed');
  });

  it('refuses the last row and a row view', async () => {
    const store = await disposedStore();
    await expect(store.lastContent()).rejects.toThrow('disposed');
    await expect(store.readRows(async () => 0)).rejects.toThrow('disposed');
  });

  it('refuses a materialization', async () => {
    const store = await disposedStore();
    await expect(store.materialize()).rejects.toThrow('disposed');
  });

  it('closes a dump snapshot that is still open, so that reading it fails as closed', async () => {
    const session = await JournalSession.create(
      path.join(directory(), 'open-dump.llxj'),
      { journal: testJournalSeams({}).dependencies },
    );
    const store = new JournalHistoryStore(session);
    store.apply({
      kind: 'content',
      content: { speaker: 'human', blocks: [{ type: 'text', text: 'row' }] },
    });
    const dump = await store.openDumpSnapshot();

    await store.dispose();

    await expect(dump.rows()[Symbol.asyncIterator]().next()).rejects.toThrow(
      'closed',
    );
  });
});
