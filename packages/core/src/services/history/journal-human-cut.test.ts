/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { openOwnedJournal } from './journalOwnedFixture.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import type { IContent } from './IContent.js';

function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: index === 1 ? [] : [{ type: 'text', text: `row ${index}` }],
  };
}

function barrier(): { promise: Promise<void>; open(): void } {
  let open = (): void => {
    throw new Error('Uninitialized barrier');
  };
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('native checkpoint human turn selection', () => {
  const directory = useTempDir('native-human-cut-');
  it.each([3, 64, 65, 5000])(
    'uses raw headers, not decoded rows or curated ranks, over %i rows',
    async (size) => {
      const journal = await openOwnedJournal(
        join(directory(), 'primary.llxj'),
        Array.from({ length: size }, (_, index) => ({ content: row(index) })),
      );
      const snapshot = await journal.session.store.snapshot();
      const dump = new JournalDumpSnapshot(snapshot);
      let decodes = 0;
      const readRow = snapshot.readRow.bind(snapshot);
      const observer = spyOn(snapshot, 'readRow').mockImplementation(
        async (...args) => {
          decodes++;
          return readRow(...args);
        },
      );
      try {
        expect(await dump.humanCut(2, false)).toBe(2);
        expect(await dump.humanCut(2, true)).toBe(
          size % 2 === 0 ? size - 4 : size - 3,
        );
        expect(await dump.humanCut(0, true)).toBe(size);
        expect(await dump.humanCut(size + 1, true)).toBe(0);
        expect(await dump.humanCut(size + 1, false)).toBe(size);
        expect(decodes).toBe(0);
        await expect(dump.humanCut(-1, true)).rejects.toThrow(RangeError);
        journal.store.apply({ kind: 'rewind', itemsRemoved: size - 1 });
        await journal.store.waitForDurable();
        expect(await dump.humanCut(2, false)).toBe(2);
        const current = new JournalDumpSnapshot(
          await journal.session.store.snapshot(),
        );
        try {
          expect(await current.humanCut(2, false)).toBe(1);
          expect(await current.humanCut(2, true)).toBe(0);
        } finally {
          await current.close();
        }
      } finally {
        observer.mockRestore();
        await dump.close();
        await journal.dispose();
      }
      await expect(dump.humanCut(1, true)).rejects.toThrow('closed');
    },
  );

  it('reads only referenced media blocks and retires an abandoned media iterator before its pin', async () => {
    const media = new LocalMediaStore({
      rootDirectory: join(directory(), 'media'),
      quotaBytes: 4096,
    });
    const reference = await media.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const journal = await openOwnedJournal(
      join(directory(), 'references.llxj'),
      [
        {
          content: {
            speaker: 'human',
            blocks: [
              { type: 'text', text: 'x'.repeat(9 * 1024 * 1024 + 17) },
              reference,
            ],
          },
        },
        { content: row(2) },
        { content: { speaker: 'human', blocks: [reference] } },
      ],
    );
    const snapshot = await journal.session.store.snapshot();
    const dump = new JournalDumpSnapshot(snapshot);
    const readRow = spyOn(snapshot, 'readRow').mockImplementation(async () => {
      throw new Error('Media selection must not decode rows');
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
      for await (const value of dump.mediaReferences()) references.push(value);
      expect(references).toStrictEqual([reference, reference]);
      expect(selected).toStrictEqual([1, 0]);
      const cursor = dump.mediaReferences();
      expect((await cursor.next()).value).toStrictEqual(reference);
      await dump.close();
      await expect(cursor.next()).rejects.toThrow('closed');
    } finally {
      readRow.mockRestore();
      blocks.mockRestore();
      await dump.close();
      await journal.dispose();
    }
  });

  it('retires an admitted header query before releasing its pin and preserves its original error', async () => {
    const journal = await openOwnedJournal(join(directory(), 'pending.llxj'), [
      { content: row(0) },
    ]);
    const snapshot = await journal.session.store.snapshot();
    const dump = new JournalDumpSnapshot(snapshot);
    const entered = barrier();
    const released = barrier();
    const failure = new Error('header query failed');
    const query = spyOn(snapshot, 'humanCut').mockImplementation(async () => {
      entered.open();
      await released.promise;
      throw failure;
    });
    let pinClosed = false;
    const close = snapshot.close.bind(snapshot);
    const pin = spyOn(snapshot, 'close').mockImplementation(async () => {
      await close();
      pinClosed = true;
    });
    try {
      const pending = dump.humanCut(1, true).catch((error: unknown) => error);
      await entered.promise;
      const closing = dump.close();
      expect(pinClosed).toBe(false);
      released.open();
      expect(await pending).toBe(failure);
      await closing;
      expect(pinClosed).toBe(true);
    } finally {
      released.open();
      query.mockRestore();
      pin.mockRestore();
      await dump.close();
      await journal.dispose();
    }
  });
});
