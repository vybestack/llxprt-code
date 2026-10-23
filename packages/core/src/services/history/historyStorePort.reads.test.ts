import { HistoryJournalStore } from './historyJournalStore.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { HistoryStorePort } from './historyStorePort.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

/** The reads both stores serve; the journal store does not implement the whole port until W6. */
type ReadsStore = Pick<
  HistoryStorePort,
  'apply' | 'lastContent' | 'readRows' | 'dispose'
>;

function row(speaker: 'human' | 'ai', text: string, seq: number): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

describe.each(['old', 'journal'] as const)(
  'HistoryStorePort asynchronous reads (%s store)',
  (backend) => {
    const directory = useTempDir('history-port-reads-');
    const open: ReadsStore[] = [];
    afterEach(async () => {
      for (const store of open.splice(0)) await store.dispose();
    });

    async function opened(): Promise<ReadsStore> {
      const store: ReadsStore =
        backend === 'old'
          ? new HistoryJournalStore()
          : new JournalHistoryStore(
              await JournalSession.create(
                path.join(directory(), 'reads.llxj'),
                {
                  journal: testJournalSeams({}).dependencies,
                },
              ),
            );
      open.push(store);
      return store;
    }

    async function withStore(
      test: (store: ReadsStore) => Promise<void>,
    ): Promise<void> {
      await test(await opened());
    }

    it('lastContent resolves the newest row, optionally of one speaker', async () => {
      await withStore(async (store) => {
        expect(await store.lastContent()).toBeUndefined();
        store.apply({ kind: 'content', content: row('human', 'one', 1) });
        store.apply({ kind: 'content', content: row('ai', 'two', 2) });
        store.apply({ kind: 'content', content: row('human', 'three', 3) });
        const pending = store.lastContent('ai');
        expect(pending).toBeInstanceOf(Promise);
        expect((await pending)?.blocks).toStrictEqual([
          { type: 'text', text: 'two' },
        ]);
        expect((await store.lastContent())?.blocks).toStrictEqual([
          { type: 'text', text: 'three' },
        ]);
        expect(await store.lastContent('tool')).toBeUndefined();
      });
    });

    it('readRows hands an asynchronous view that stays valid across awaits', async () => {
      await withStore(async (store) => {
        store.apply({ kind: 'content', content: row('human', 'one', 1) });
        store.apply({
          kind: 'content',
          content: row('ai', 'two', 2),
          origin: 'writer-a',
        });
        const origins = await store.readRows(async (view) => {
          const seen: Array<string | undefined> = [];
          for (let index = 0; index < view.length; index++) {
            await Promise.resolve();
            seen.push(await view.originAt(index));
          }
          return seen;
        });
        expect(origins).toStrictEqual([undefined, 'writer-a']);
      });
    });

    it('readRows view serves chronology seqs and rows asynchronously', async () => {
      await withStore(async (store) => {
        store.apply({ kind: 'content', content: row('human', 'one', 4) });
        store.apply({ kind: 'content', content: row('ai', 'two', 9) });
        const seen = await store.readRows(async (view) => {
          const seqs: Array<number | undefined> = [];
          for (let index = 0; index < view.length; index++)
            seqs.push(await view.chronologySeqAt(index));
          const texts: string[] = [];
          for await (const content of view.rows())
            texts.push(JSON.stringify(content.blocks));
          return { seqs, texts };
        });
        expect(seen.seqs).toStrictEqual([4, 9]);
        expect(seen.texts).toStrictEqual([
          JSON.stringify([{ type: 'text', text: 'one' }]),
          JSON.stringify([{ type: 'text', text: 'two' }]),
        ]);
      });
    });

    it('readRows closes the view when the callback has settled', async () => {
      await withStore(async (store) => {
        store.apply({ kind: 'content', content: row('human', 'one', 1) });
        let escaped: Parameters<Parameters<HistoryStorePort['readRows']>[0]>[0];
        await store.readRows((view) => {
          escaped = view;
          return Promise.resolve();
        });
        await expect(escaped!.originAt(0)).rejects.toThrow(/closed/);
      });
    });
  },
);
