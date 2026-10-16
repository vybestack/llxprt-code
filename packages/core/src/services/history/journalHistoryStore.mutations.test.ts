/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { encodeContentRow } from './journalRowCodec.js';
import { JournalSession } from './journalSession.js';

function row(text: string, seq?: number, speaker: 'human' | 'ai' = 'human') {
  const content: IContent = {
    speaker,
    blocks: [{ type: 'text', text }],
  };
  if (seq !== undefined) {
    content.metadata = {
      chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 },
    };
  }
  return content;
}

function texts(contents: readonly IContent[]): string[] {
  return contents.map((content) =>
    content.blocks
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join(''),
  );
}

describe('journal history store mutations', () => {
  const directory = useTempDir('journal-history-mutations-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  /** A store over a journal that already holds `rows`, each written under `ownerOf(index)`. */
  async function seeded(
    name: string,
    rows: readonly IContent[],
    ownerOf: (index: number) => number = () => 0,
  ): Promise<{
    store: JournalHistoryStore;
    session: JournalSession;
    seededCommitSeq: number | undefined;
  }> {
    const session = await JournalSession.create(path.join(directory(), name));
    const { commitSeq } = await session.store.commit([
      {
        kind: 'append',
        rows: rows.map((content, index) =>
          encodeContentRow(content, { owner: ownerOf(index) }),
        ),
      },
    ]);
    const seededCommitSeq: number | undefined = commitSeq;
    const store = new JournalHistoryStore(session);
    open.push(store);
    return { store, session, seededCommitSeq };
  }

  async function entriesOf(session: JournalSession): Promise<RowEntry[]> {
    const entries: RowEntry[] = [];
    for await (const entry of session.store.snapshot().entries())
      entries.push(entry);
    return entries;
  }

  describe('density', () => {
    it('removes the rows named by chronology number and replaces others in place', async () => {
      const { store } = await seeded('density.llxj', [
        row('r1', 1),
        row('r2', 2),
        row('r3', 3),
        row('r4', 4),
        row('r5', 5),
      ]);

      store.apply({
        kind: 'density',
        payload: {
          removedSeqs: [2],
          replacements: [{ replacedSeq: 4, replacement: row('short', 4) }],
        },
      });

      expect(store.getLength()).toBe(4);
      expect(texts(await store.materialize())).toStrictEqual([
        'r1',
        'r3',
        'short',
        'r5',
      ]);
    });

    it('lets a replacement win over a removal of the same number', async () => {
      const { store } = await seeded('density-win.llxj', [
        row('r1', 1),
        row('r2', 2),
      ]);

      store.apply({
        kind: 'density',
        payload: {
          removedSeqs: [2],
          replacements: [{ replacedSeq: 2, replacement: row('kept', 2) }],
        },
      });

      expect(store.getLength()).toBe(2);
      expect(texts(await store.materialize())).toStrictEqual(['r1', 'kept']);
    });

    it('fails the queue when no row has a named chronology number', async () => {
      const { store } = await seeded('density-missing.llxj', [row('r1', 1)]);

      store.apply({
        kind: 'density',
        payload: { removedSeqs: [9], replacements: [] },
      });

      await expect(store.waitForDurable()).rejects.toThrow(
        'no row has chronology number 9',
      );
    });

    it('fails the queue when a chronology number names two rows', async () => {
      const { store } = await seeded('density-twice.llxj', [
        row('a', 1),
        row('b', 1),
      ]);

      store.apply({
        kind: 'density',
        payload: { removedSeqs: [1], replacements: [] },
      });

      await expect(store.waitForDurable()).rejects.toThrow(
        'chronology number 1 names 2 rows',
      );
    });

    it('writes no group for an empty density', async () => {
      const { store } = await seeded('density-empty.llxj', [row('r1', 1)]);

      store.apply({
        kind: 'density',
        payload: { removedSeqs: [], replacements: [] },
      });
      await store.waitForDurable();

      expect(store.lastAck).toBeUndefined();
    });

    // Defect #3: past 64 changed rows the old store wrote the replacements
    // without their owners, so every agent's mirror took them.
    it.each([3, 64, 65, 5000])(
      'keeps the owner of every row when %i rows change',
      async (changed) => {
        const rows = Array.from({ length: changed }, (_, index) =>
          row(`original ${index}`, index + 1),
        );
        const ownerOf = (index: number) => [0, 2, 3][index % 3];
        const { store, session } = await seeded(
          `defect3-${changed}.llxj`,
          rows,
          ownerOf,
        );

        // One group rebuilds the whole index (design 4.10), so 5,000 rows go
        // in five groups; the 64-row batches of the old caller are S05's.
        const chunk = changed === 5000 ? 1000 : changed;
        for (let start = 0; start < changed; start += chunk) {
          store.apply({
            kind: 'density',
            payload: {
              removedSeqs: [],
              replacements: rows
                .slice(start, start + chunk)
                .map((content, at) => ({
                  replacedSeq: start + at + 1,
                  replacement: row(`changed ${start + at}`, start + at + 1),
                })),
            },
          });
        }
        await store.waitForDurable();

        expect(store.getLength()).toBe(changed);
        const entries = await entriesOf(session);
        expect(entries.map((entry) => entry.owner)).toStrictEqual(
          rows.map((_, index) => ownerOf(index)),
        );
        const all = texts(await store.materialize());
        expect(all).toStrictEqual(rows.map((_, index) => `changed ${index}`));
      },
      180_000,
    );
  });

  describe('purge', () => {
    it('rewrites the rows at the given positions under their own labels and owners', async () => {
      const { store, session } = await seeded(
        'purge.llxj',
        [row('a', 1), row('b', 2), row('c', 3)],
        (index) => index + 1,
      );
      const before = await entriesOf(session);

      store.purge([
        { position: 2, content: row('c purged', 3) },
        { position: 0, content: row('a purged', 1) },
      ]);

      expect(store.getLength()).toBe(3);
      expect(texts(await store.materialize())).toStrictEqual([
        'a purged',
        'b',
        'c purged',
      ]);
      const after = await entriesOf(session);
      expect(after.map((entry) => entry.label)).toStrictEqual(
        before.map((entry) => entry.label),
      );
      expect(after.map((entry) => entry.owner)).toStrictEqual([1, 2, 3]);
    });

    it('refuses a position outside the history or named twice, and writes nothing', async () => {
      const { store } = await seeded('purge-bad.llxj', [row('a', 1)]);

      expect(() => store.purge([{ position: 1, content: row('x') }])).toThrow(
        'Position 1',
      );
      expect(() =>
        store.purge([
          { position: 0, content: row('x') },
          { position: 0, content: row('y') },
        ]),
      ).toThrow('named twice');
      await store.waitForDurable();
      expect(store.lastAck).toBeUndefined();
    });
  });

  describe('owner change', () => {
    it('gives the rows at the given positions their new owner and keeps their content', async () => {
      const { store, session } = await seeded(
        'owner.llxj',
        [row('a', 1), row('b', 2), row('c', 3)],
        () => 1,
      );

      store.changeOwners([
        { position: 1, owner: 7 },
        { position: 2, owner: 0 },
      ]);
      await store.waitForDurable();

      expect(texts(await store.materialize())).toStrictEqual(['a', 'b', 'c']);
      const entries = await entriesOf(session);
      expect(entries.map((entry) => entry.owner)).toStrictEqual([1, 7, 0]);
    });

    it('fails the queue on an owner outside the range the format holds', async () => {
      const { store } = await seeded('owner-bad.llxj', [row('a', 1)]);

      store.changeOwners([{ position: 0, owner: -1 }]);

      await expect(store.waitForDurable()).rejects.toThrow('owner');
    });
  });

  describe('fill', () => {
    it('sets entry fields without changing rows', async () => {
      const { store, session } = await seeded('fill.llxj', [
        row('a', 1),
        row('b', 2),
      ]);
      const [first] = await entriesOf(session);

      store.fill([{ label: first.label, lensRef: [11, 0, 0] }]);
      await store.waitForDurable();

      expect(store.getLength()).toBe(2);
      expect(texts(await store.materialize())).toStrictEqual(['a', 'b']);
      const [filled] = await entriesOf(session);
      expect(filled.lensRef).toStrictEqual([11, 0, 0]);
    });
  });

  describe('replace from an array', () => {
    it('replaces the whole history by the rows, in one group', async () => {
      const { store, seededCommitSeq } = await seeded('replace.llxj', [
        row('a', 1),
        row('b', 2),
        row('c', 3),
      ]);

      store.replaceAll([row('x', 4), row('y', 5)]);

      expect(store.getLength()).toBe(2);
      expect(texts(await store.materialize())).toStrictEqual(['x', 'y']);
      expect(store.lastAck?.commitSeq).toBe((seededCommitSeq ?? 0) + 1);
    });

    it('replaces by an empty array, which is a clear', async () => {
      const { store } = await seeded('replace-empty.llxj', [row('a', 1)]);

      store.replaceAll([]);

      expect(store.getLength()).toBe(0);
      expect(texts(await store.materialize())).toStrictEqual([]);
    });

    it('is not changed by the caller editing its array afterwards', async () => {
      const { store } = await seeded('replace-held.llxj', [row('a', 1)]);
      const rows = [row('x', 2), row('y', 3)];

      store.replaceAll(rows);
      rows.length = 0;

      expect(texts(await store.materialize())).toStrictEqual(['x', 'y']);
    });
  });
});
