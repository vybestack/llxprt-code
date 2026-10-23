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

/** What both stores serve for a profile replacement; the journal store does not implement the whole port until W6. */
type ReplacementStore = Pick<
  HistoryStorePort,
  | 'apply'
  | 'stageProfileReplacement'
  | 'getLength'
  | 'streamRows'
  | 'waitForDurable'
  | 'dispose'
>;

function row(speaker: 'human' | 'ai', text: string, seq: number): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

async function textsOf(store: ReplacementStore): Promise<string[]> {
  const texts: string[] = [];
  for await (const content of store.streamRows()) {
    const [first] = content.blocks;
    texts.push(first.type === 'text' ? first.text : first.type);
  }
  return texts;
}

describe.each(['old', 'journal'] as const)(
  'HistoryStorePort.stageProfileReplacement (%s store)',
  (backend) => {
    const directory = useTempDir('history-port-profile-');
    const open: ReplacementStore[] = [];
    let counter = 0;

    afterEach(async () => {
      for (const store of open.splice(0)) await store.dispose();
    });

    async function opened(
      rows: readonly IContent[],
    ): Promise<ReplacementStore> {
      const store: ReplacementStore =
        backend === 'old'
          ? new HistoryJournalStore()
          : new JournalHistoryStore(
              await JournalSession.create(
                path.join(directory(), `profile-${counter++}.llxj`),
                { journal: testJournalSeams({}).dependencies },
              ),
            );
      open.push(store);
      for (const content of rows) store.apply({ kind: 'content', content });
      await store.waitForDurable();
      return store;
    }

    it('makes the live rows the candidate rows at commit', async () => {
      const live = await opened([row('human', 'one', 1), row('ai', 'two', 2)]);
      const candidate = await opened([
        row('human', 'other', 1),
        row('ai', 'answer', 2),
        row('human', 'more', 3),
      ]);
      const staged = await live.stageProfileReplacement(candidate, {});
      staged.commit();
      await live.waitForDurable();
      expect(await textsOf(live)).toStrictEqual(['other', 'answer', 'more']);
      expect(live.getLength()).toBe(3);
      expect(await textsOf(candidate)).toStrictEqual([
        'other',
        'answer',
        'more',
      ]);
    });

    it('takes a candidate that only drops the tail', async () => {
      const rows = [row('human', 'one', 1), row('ai', 'two', 2)];
      const live = await opened(rows);
      const candidate = await opened([rows[0]]);
      const staged = await live.stageProfileReplacement(candidate, {});
      staged.commit();
      await live.waitForDurable();
      expect(await textsOf(live)).toStrictEqual(['one']);
      expect(live.getLength()).toBe(1);
    });

    it('takes an empty candidate', async () => {
      const live = await opened([row('human', 'one', 1)]);
      const candidate = await opened([]);
      const staged = await live.stageProfileReplacement(candidate, {});
      staged.commit();
      await live.waitForDurable();
      expect(await textsOf(live)).toStrictEqual([]);
      expect(live.getLength()).toBe(0);
    });

    it('commits an identical candidate and keeps the rows', async () => {
      const rows = [row('human', 'one', 1), row('ai', 'two', 2)];
      const live = await opened(rows);
      const candidate = await opened(rows);
      const staged = await live.stageProfileReplacement(candidate, {});
      staged.commit();
      await live.waitForDurable();
      expect(await textsOf(live)).toStrictEqual(['one', 'two']);
    });

    it('leaves the previous rows after a rollback', async () => {
      const live = await opened([row('human', 'one', 1), row('ai', 'two', 2)]);
      const candidate = await opened([row('human', 'other', 1)]);
      const staged = await live.stageProfileReplacement(candidate, {});
      await staged.rollback();
      await live.waitForDurable();
      expect(await textsOf(live)).toStrictEqual(['one', 'two']);
      expect(live.getLength()).toBe(2);
    });

    it('refuses to commit when the live history was written after staging', async () => {
      const live = await opened([row('human', 'one', 1)]);
      const candidate = await opened([row('human', 'other', 1)]);
      const staged = await live.stageProfileReplacement(candidate, {});
      live.apply({ kind: 'content', content: row('ai', 'late', 2) });
      await live.waitForDurable();
      expect(() => staged.commit()).toThrow(/changed after it was prepared/);
    });

    it('cannot commit twice', async () => {
      const live = await opened([row('human', 'one', 1)]);
      const candidate = await opened([row('human', 'other', 1)]);
      const staged = await live.stageProfileReplacement(candidate, {});
      staged.commit();
      expect(() => staged.commit()).toThrow(/already settled/);
    });
  },
);

describe('journal profile replacement failure', () => {
  const directory = useTempDir('history-port-profile-fail-');

  async function liveWithTwoRows(): Promise<JournalHistoryStore> {
    const live = new JournalHistoryStore(
      await JournalSession.create(path.join(directory(), 'live.llxj'), {
        journal: testJournalSeams({}).dependencies,
      }),
    );
    live.apply({ kind: 'content', content: row('human', 'one', 1) });
    live.apply({ kind: 'content', content: row('ai', 'two', 2) });
    await live.waitForDurable();
    return live;
  }

  it('reports a candidate that fails before its first row and keeps the live rows', async () => {
    const live = await liveWithTwoRows();
    try {
      const failure = new Error('candidate cannot be read');
      const candidate = {
        getLength: () => 3,
        streamRows: (): AsyncIterable<IContent> => ({
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(failure),
          }),
        }),
      };
      await expect(live.stageProfileReplacement(candidate, {})).rejects.toBe(
        failure,
      );
      expect(await textsOf(live)).toStrictEqual(['one', 'two']);
      live.apply({ kind: 'content', content: row('human', 'after', 3) });
      await live.waitForDurable();
      expect(await textsOf(live)).toStrictEqual(['one', 'two', 'after']);
    } finally {
      await live.dispose();
    }
  });

  it('keeps the live rows when the candidate fails after its first row', async () => {
    const live = await liveWithTwoRows();
    try {
      const failure = new Error('candidate failed mid-stream');
      const candidate = {
        getLength: () => 3,
        async *streamRows(): AsyncGenerator<IContent> {
          yield row('human', 'x', 1);
          throw failure;
        },
      };
      await expect(live.stageProfileReplacement(candidate, {})).rejects.toBe(
        failure,
      );
      expect(await textsOf(live)).toStrictEqual(['one', 'two']);
    } finally {
      await live.dispose();
    }
  });
});
