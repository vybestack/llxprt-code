/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from './journalSession.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { NativeJournalPageReader } from '../../journal/native-journal-page-reader.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';

async function assertDisplay(path: string, id: bigint): Promise<void> {
  const reader = await NativeJournalPageReader.open(path);
  try {
    for await (const row of reader.entries()) {
      if (row.transcriptId !== id) continue;
      expect((await reader.readContent(row)).blocks).toStrictEqual([
        { type: 'text', text: 'primary presentation' },
      ]);
      expect((await reader.presentation(row))?.descriptor.type).toBe('info');
      return;
    }
    throw new Error('Missing persisted presentation');
  } finally {
    await reader.close();
  }
}

describe('primary journal presentation ownership', () => {
  const directory = useTempDir('display-primary-');
  it('persists presentation to the primary when no recorder is attached', async () => {
    const path = join(directory(), 'primary.llxj');
    const store = new JournalHistoryStore(await JournalSession.create(path));
    try {
      const display = await store.appendDisplay(
        { type: 'info' },
        'primary presentation',
      );
      await assertDisplay(path, display.transcriptId);
      expect(store.getLength()).toBe(0);
    } finally {
      await store.dispose();
    }
  });
});
