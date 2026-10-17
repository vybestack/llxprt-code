/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { OwnerDictionary } from '../../journal/ownerDictionary.js';
import type { IContent } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

function row(text: string, seq?: number): IContent {
  const content: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  };
  if (seq !== undefined) {
    content.metadata = {
      chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 },
    };
  }
  return content;
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

/** The text and current owner id of every live row of a journal file. */
async function held(session: JournalSession): Promise<Array<[string, number]>> {
  const rows: Array<[string, number]> = [];
  for await (const { entry, content } of session.rows())
    rows.push([textOf(content), entry.owner]);
  return rows;
}

async function texts(session: JournalSession): Promise<string[]> {
  return (await held(session)).map(([text]) => text);
}

describe('journal history store owners and mirrors', () => {
  const directory = useTempDir('journal-history-fanout-');
  const stores: JournalHistoryStore[] = [];
  const sessions: JournalSession[] = [];
  afterEach(async () => {
    for (const store of stores.splice(0)) await store.dispose();
    for (const session of sessions.splice(0)) await session.close();
  });

  async function newSession(name: string): Promise<JournalSession> {
    const session = await JournalSession.create(path.join(directory(), name));
    sessions.push(session);
    return session;
  }

  async function newStore(name: string): Promise<{
    store: JournalHistoryStore;
    primary: JournalSession;
  }> {
    const primary = await newSession(name);
    const store = new JournalHistoryStore(primary);
    stores.push(store);
    return { store, primary };
  }

  describe('origins become owner ids', () => {
    it('writes a row under the id of its origin and records the origin with the first row', async () => {
      const { store, primary } = await newStore('origins.llxj');

      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      store.apply({ kind: 'content', content: row('b1'), origin: 'agent-b' });
      store.apply({ kind: 'content', content: row('a2'), origin: 'agent-a' });
      store.apply({ kind: 'content', content: row('shared') });
      await store.waitForDurable();

      expect(await held(primary)).toStrictEqual([
        ['a1', 1],
        ['b1', 2],
        ['a2', 1],
        ['shared', 0],
      ]);
      const dictionary = await OwnerDictionary.load(primary.store);
      expect(dictionary.originOf(1)).toBe('agent-a');
      expect(dictionary.originOf(2)).toBe('agent-b');
      // Four rows, four groups: a registration rides in the group of its first row.
      expect(store.lastAck?.commitSeq).toBe(4);
    });

    it('keeps the ids of a journal that is opened again', async () => {
      const { store, primary } = await newStore('reopen.llxj');
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      store.apply({ kind: 'content', content: row('b1'), origin: 'agent-b' });
      await store.waitForDurable();
      const file = primary.path;
      await store.dispose();
      await primary.close();

      const reopened = await JournalSession.open(file);
      sessions.push(reopened);
      const again = new JournalHistoryStore(reopened);
      stores.push(again);
      again.apply({ kind: 'content', content: row('b2'), origin: 'agent-b' });
      again.apply({ kind: 'content', content: row('c1'), origin: 'agent-c' });
      await again.waitForDurable();

      expect(await held(reopened)).toStrictEqual([
        ['a1', 1],
        ['b1', 2],
        ['b2', 2],
        ['c1', 3],
      ]);
    });

    it('gives a synthetic insert the owner it names, else the owner of its anchor, and a summary the owner it names', async () => {
      const { store, primary } = await newStore('summary.llxj');
      store.apply({
        kind: 'content',
        content: row('a1', 1),
        origin: 'agent-a',
      });
      store.apply({
        kind: 'syntheticInsert',
        payload: { content: row('after-a', 2), chronologySeq: 2, afterSeq: 1 },
      });
      store.apply({
        kind: 'syntheticInsert',
        payload: { content: row('named-b', 3), chronologySeq: 3, afterSeq: 1 },
        origin: 'agent-b',
      });
      await store.waitForDurable();
      expect(await held(primary)).toStrictEqual([
        ['a1', 1],
        ['named-b', 2],
        ['after-a', 1],
      ]);

      store.apply({
        kind: 'compressed',
        summary: row('sum'),
        itemsCompressed: 3,
        origin: 'agent-b',
      });
      await store.waitForDurable();
      expect(await held(primary)).toStrictEqual([['sum', 2]]);
    });

    it('writes a replace group under the origin it is given', async () => {
      const { store, primary } = await newStore('replace.llxj');
      store.apply({ kind: 'content', content: row('old') });
      store.replaceAll([row('n1'), row('n2')], 'agent-a');
      await store.waitForDurable();
      expect(await held(primary)).toStrictEqual([
        ['n1', 1],
        ['n2', 1],
      ]);

      await store.replaceFrom([row('s1')], 1, undefined, 'agent-b');
      expect(await held(primary)).toStrictEqual([['s1', 2]]);
    });

    it('changes the owner of rows by origin, and an undefined origin makes them unowned', async () => {
      const { store, primary } = await newStore('change.llxj');
      for (const text of ['r0', 'r1', 'r2'])
        store.apply({ kind: 'content', content: row(text), origin: 'agent-a' });
      store.changeOwnersOf([
        { position: 0, origin: undefined },
        { position: 2, origin: 'agent-b' },
      ]);
      await store.waitForDurable();
      expect(await held(primary)).toStrictEqual([
        ['r0', 0],
        ['r1', 1],
        ['r2', 2],
      ]);
    });
  });

  describe('mirrors', () => {
    it('holds in each mirror its own rows and the unowned ones, as rows are appended', async () => {
      const { store } = await newStore('append.llxj');
      const mirrorA = await newSession('append-a.llxj');
      const mirrorB = await newSession('append-b.llxj');
      await store.attachMirror(mirrorA, 'agent-a');
      await store.attachMirror(mirrorB, 'agent-b');

      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      store.apply({ kind: 'content', content: row('shared') });
      store.apply({ kind: 'content', content: row('b1'), origin: 'agent-b' });
      await store.waitForDurable();
      await store.settleFanout();

      expect(await texts(mirrorA)).toStrictEqual(['a1', 'shared']);
      expect(await texts(mirrorB)).toStrictEqual(['shared', 'b1']);
    });

    // Defect #3 through the store with two agents: past 64 changed rows the
    // old store wrote the replacements unowned, so both mirrors took them.
    it.each([3, 64, 65, 5000])(
      'keeps %i changed rows with their agent when two agents record',
      async (changed) => {
        const { store, primary } = await newStore(`defect3-${changed}.llxj`);
        const mirrorA = await newSession(`defect3-${changed}-a.llxj`);
        const mirrorB = await newSession(`defect3-${changed}-b.llxj`);
        await store.attachMirror(mirrorA, 'agent-a');
        await store.attachMirror(mirrorB, 'agent-b');
        const origins = ['agent-a', 'agent-b', undefined] as const;
        for (let index = 0; index < changed; index++) {
          store.apply({
            kind: 'content',
            content: row(`original ${index}`, index + 1),
            origin: origins[index % 3],
          });
        }
        await store.waitForDurable();

        const chunk = changed === 5000 ? 1000 : changed;
        for (let start = 0; start < changed; start += chunk) {
          store.apply({
            kind: 'density',
            payload: {
              removedSeqs: [],
              replacements: Array.from(
                { length: Math.min(chunk, changed - start) },
                (_, at) => ({
                  replacedSeq: start + at + 1,
                  replacement: row(`changed ${start + at}`, start + at + 1),
                }),
              ),
            },
          });
        }
        await store.waitForDurable();
        await store.settleFanout();

        const indices = Array.from({ length: changed }, (_, index) => index);
        const accepted = (agent: number) =>
          indices
            .filter((index) => index % 3 === agent || index % 3 === 2)
            .map((index) => `changed ${index}`);
        expect(await texts(primary)).toStrictEqual(
          indices.map((index) => `changed ${index}`),
        );
        expect(await texts(mirrorA)).toStrictEqual(accepted(0));
        expect(await texts(mirrorB)).toStrictEqual(accepted(1));
      },
      180_000,
    );

    // Defect #4: a row whose owner changed after it was written went to the
    // owner it was written under when a second agent attached.
    it('seeds a late mirror by the current owner, not the owner at write time', async () => {
      const { store } = await newStore('defect4.llxj');
      const mirrorA = await newSession('defect4-a.llxj');
      store.apply({
        kind: 'content',
        content: row('first'),
        origin: 'agent-a',
      });
      store.apply({
        kind: 'content',
        content: row('second'),
        origin: 'agent-a',
      });
      store.apply({ kind: 'content', content: row('shared') });
      await store.attachMirror(mirrorA, 'agent-a');
      store.changeOwnersOf([{ position: 1, origin: 'agent-b' }]);
      await store.waitForDurable();

      const mirrorB = await newSession('defect4-b.llxj');
      await store.attachMirror(mirrorB, 'agent-b');
      await store.settleFanout();

      expect(await texts(mirrorB)).toStrictEqual(['second', 'shared']);
      expect(await texts(mirrorA)).toStrictEqual(['first', 'shared']);
    });

    it('seeds a late mirror with what was queued before the attach, and delivers later groups after it', async () => {
      const { store } = await newStore('late.llxj');
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      store.apply({ kind: 'content', content: row('b1'), origin: 'agent-b' });
      store.apply({ kind: 'content', content: row('shared') });
      const mirror = await newSession('late-a.llxj');
      const attached = store.attachMirror(mirror, 'agent-a');
      store.apply({ kind: 'content', content: row('a2'), origin: 'agent-a' });
      store.apply({ kind: 'content', content: row('b2'), origin: 'agent-b' });
      await attached;
      await store.waitForDurable();
      await store.settleFanout();

      expect(await texts(mirror)).toStrictEqual(['a1', 'shared', 'a2']);
    });

    it('follows a compensation: the mirror gets the restored version', async () => {
      const { store } = await newStore('compensate.llxj');
      const mirror = await newSession('compensate-a.llxj');
      await store.attachMirror(mirror, 'agent-a');
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      store.apply({ kind: 'content', content: row('shared') });
      await store.waitForDurable();

      const mark = store.captureCompensation();
      store.apply({ kind: 'content', content: row('a2'), origin: 'agent-a' });
      store.apply({ kind: 'content', content: row('b2'), origin: 'agent-b' });
      await store.waitForDurable();
      await store.compensate(mark, undefined);
      await store.settleFanout();

      expect(await texts(mirror)).toStrictEqual(['a1', 'shared']);
    });

    it('stops delivering to a detached mirror', async () => {
      const { store } = await newStore('detach.llxj');
      const mirror = await newSession('detach-a.llxj');
      await store.attachMirror(mirror, 'agent-a');
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      expect(await store.detachMirror(mirror)).toBe(true);
      expect(store.isMirror(mirror)).toBe(false);
      store.apply({ kind: 'content', content: row('a2'), origin: 'agent-a' });
      await store.waitForDurable();
      await store.settleFanout();

      expect(await texts(mirror)).toStrictEqual(['a1']);
      expect(await store.detachMirror(mirror)).toBe(false);
    });

    it('reports a mirror that cannot take a group when the fan-out is settled', async () => {
      const { store } = await newStore('failing.llxj');
      const mirror = await newSession('failing-a.llxj');
      await store.attachMirror(mirror, 'agent-a');
      await mirror.close();
      store.apply({ kind: 'content', content: row('a1'), origin: 'agent-a' });
      await store.waitForDurable();

      await expect(store.settleFanout()).rejects.toThrow('closed');
      // A clean shutdown reports the same failure instead of leaving the mirror silently behind.
      await expect(store.dispose()).rejects.toThrow('closed');
    });
  });

  describe('origin of the primary', () => {
    it('refuses an adoption without an origin once a mirror is bound, and tells retirement listeners on dispose', async () => {
      const { store } = await newStore('adopt.llxj');
      const retired: string[] = [];
      store.onRetired(() => retired.push('retired'));
      store.adoptedOrigin(undefined);
      store.adoptedOrigin('agent-a');
      expect(store.primaryOriginId()).toBe('agent-a');

      await store.attachMirror(await newSession('adopt-a.llxj'), 'agent-a');
      expect(() => store.adoptedOrigin(undefined)).toThrow(
        'must name its origin',
      );

      await store.dispose();
      expect(retired).toStrictEqual(['retired']);
    });
  });
});
