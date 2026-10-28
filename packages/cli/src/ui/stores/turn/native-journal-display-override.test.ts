/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '@vybestack/llxprt-code-core';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { NativeJournalCursor } from './native-journal-cursor.js';

describe('journal file prompt display', () => {
  const directory = useTempDir('journal-display-');
  it('renders a file prompt display override once instead of repeating it for every text slice', async () => {
    const session = await JournalSession.create(
      join(directory(), 'display.llxj'),
    );
    try {
      await session.append([
        {
          speaker: 'human',
          metadata: { displayText: '@large.txt' },
          blocks: [
            { type: 'text', text: 'expanded file contents '.repeat(5000) },
          ],
        },
      ]);
      const cursor = await NativeJournalCursor.open(session.path, {}, 100);
      try {
        const entries = (await cursor.pageBack(100)).entries;
        const items = entries.flatMap((entry) =>
          entry.kind === 'projected' ? [entry.item] : [],
        );
        expect(items.map((item) => item.text)).toStrictEqual(['@large.txt']);
      } finally {
        await cursor.close();
      }
    } finally {
      await session.close();
    }
  });
});
