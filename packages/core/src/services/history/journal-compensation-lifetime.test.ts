/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { fstatSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalDetachedPublication } from './journalDetachedPublication.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

describe('history compensation reader lifetime', () => {
  const directory = useTempDir('journal-compensation-lifetime-');

  async function created(): Promise<{
    store: JournalHistoryStore;
    fd: number;
  }> {
    let fd = -1;
    const session = await JournalSession.create(
      join(directory(), 'history.llxj'),
      {
        journal: {
          open: async (file, flags) => {
            const handle = await open(file, flags);
            fd = handle.fd;
            return handle;
          },
        },
      },
    );
    return { store: new JournalHistoryStore(session), fd };
  }

  it('closes compensation pins owned by the disposed history', async () => {
    const { store, fd } = await created();
    const publication = new JournalDetachedPublication(store);
    await publication.publish(
      [],
      [{ speaker: 'human', blocks: [{ type: 'text', text: 'new history' }] }],
    );
    await publication.compensate();

    await store.dispose();

    expect(() => fstatSync(fd)).toThrow(/EBADF/);
    await publication.release();
  });

  it('closes marks whose snapshot capture was still queued when disposal began', async () => {
    const { store, fd } = await created();
    store.apply({
      kind: 'content',
      content: { speaker: 'human', blocks: [{ type: 'text', text: 'queued' }] },
    });
    const mark = store.captureCompensation();

    await store.dispose();

    expect(() => fstatSync(fd)).toThrow(/EBADF/);
    await store.releaseCompensation(mark);
  });
});
