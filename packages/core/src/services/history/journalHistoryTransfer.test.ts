/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Cloning a journal for a new session and attaching one history to another
 * journal, on the journal backend. Behaviour of `cloneHistoryJournal` and
 * `appendHistoryJournal` that carries over keeps its assertions (a failed
 * replacement leaves the previous history, a cancelled clone leaves no file,
 * owned rows keep their owner); the replacement-in-flight cases of the JSONL
 * clone have no counterpart because a group is atomic.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  testJournalSeams,
  type Failures,
} from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { OwnerDictionary } from '../../journal/ownerDictionary.js';
import { HistoryAttachmentError } from './attachHistoryJournal.js';
import type { IContent } from './IContent.js';
import {
  attachJournalHistory,
  cloneJournalHistory,
} from './journalHistoryTransfer.js';
import { JournalSession } from './journalSession.js';

function row(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

async function texts(session: JournalSession): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of session.rows()) {
    const block = entry.content.blocks[0];
    found.push(block.type === 'text' ? block.text : '');
  }
  return found;
}

async function owners(session: JournalSession): Promise<number[]> {
  const found: number[] = [];
  for await (const entry of session.rows()) found.push(entry.entry.owner);
  return found;
}

/** Gives the journal the owner ids 1, 2, ... for the origins, in order. */
async function registerOwners(
  session: JournalSession,
  origins: readonly string[],
): Promise<void> {
  const dictionary = await OwnerDictionary.load(session.store);
  for (const origin of origins) {
    const registration = dictionary.prepare(origin);
    await session.store.commit([...registration.edits]);
    dictionary.confirm(registration);
  }
}

async function originsOf(
  session: JournalSession,
): Promise<Array<string | undefined>> {
  const dictionary = await OwnerDictionary.load(session.store);
  return (await owners(session)).map((id) => dictionary.originOf(id));
}

describe('journal history transfer', () => {
  const directory = useTempDir('journal-transfer-');
  const open: JournalSession[] = [];

  async function session(
    name: string,
    failures: Failures = {},
  ): Promise<JournalSession> {
    const created = await JournalSession.create(path.join(directory(), name), {
      journal: testJournalSeams(failures).dependencies,
    });
    open.push(created);
    return created;
  }

  async function closeAll(): Promise<void> {
    for (const each of open.splice(0))
      await each.close().catch(() => undefined);
  }

  async function withCleanup(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } finally {
      await closeAll();
    }
  }

  describe('clone of the published version into a new file', () => {
    it('holds the same rows and owners, and a later write to either does not reach the other', () =>
      withCleanup(async () => {
        const source = await session('source.llxj');
        await source.append([row('a'), row('b')], { owner: 1 });
        await source.append([row('c')], { owner: 2 });
        const before = await fsp.readFile(source.path);

        const target = path.join(directory(), 'clone.llxj');
        const clone = await cloneJournalHistory(
          source,
          target,
          { journal: testJournalSeams().dependencies },
          () => false,
        );
        open.push(clone);

        expect(await texts(clone)).toStrictEqual(['a', 'b', 'c']);
        expect(await owners(clone)).toStrictEqual([1, 1, 2]);
        expect(await fsp.readFile(source.path)).toStrictEqual(before);
        await clone.append([row('only in clone')]);
        await source.append([row('only in source')]);
        expect(await texts(clone)).toStrictEqual([
          'a',
          'b',
          'c',
          'only in clone',
        ]);
        expect(await texts(source)).toStrictEqual([
          'a',
          'b',
          'c',
          'only in source',
        ]);
      }));

    it('clones a journal that holds no group into an empty journal', () =>
      withCleanup(async () => {
        const source = await session('empty.llxj');
        const clone = await cloneJournalHistory(
          source,
          path.join(directory(), 'clone.llxj'),
          { journal: testJournalSeams().dependencies },
          () => false,
        );
        open.push(clone);

        expect(await texts(clone)).toStrictEqual([]);
      }));

    for (const cancelledAfterCalls of [0, 1]) {
      it(`leaves no file when the store is disposed after ${cancelledAfterCalls} checks`, () =>
        withCleanup(async () => {
          const source = await session('source.llxj');
          await source.append([row('a')]);
          const target = path.join(directory(), 'clone.llxj');
          let calls = 0;

          await expect(
            cloneJournalHistory(
              source,
              target,
              { journal: testJournalSeams().dependencies },
              () => calls++ >= cancelledAfterCalls,
            ),
          ).rejects.toThrow('History journal store is disposed');

          await expect(fsp.stat(target)).rejects.toThrow('ENOENT');
        }));
    }
  });

  describe('attaching one history to another journal', () => {
    async function seededSource(): Promise<JournalSession> {
      const source = await session('source.llxj');
      await registerOwners(source, ['agent:one', 'agent:two']);
      await source.append([row('one-a')], { owner: 1 });
      await source.append([row('shared')], { owner: 0 });
      await source.append([row('two-a')], { owner: 2 });
      await source.append([row('one-b')], { owner: 1 });
      return source;
    }

    it('replaces the destination history with the rows of the source in one group', () =>
      withCleanup(async () => {
        const source = await seededSource();
        const destination = await session('destination.llxj');
        await destination.append([row('old')]);

        const attached = await attachJournalHistory(
          source.store,
          destination.store,
          { replace: true, isCancelled: () => false },
        );

        expect(await texts(destination)).toStrictEqual([
          'one-a',
          'shared',
          'two-a',
          'one-b',
        ]);
        expect(attached).toMatchObject({
          committedRows: 4,
          destinationRewound: true,
        });
      }));

    it('keeps only the rows an owner accepts, unowned rows included, with their owners', () =>
      withCleanup(async () => {
        const source = await seededSource();
        const destination = await session('destination.llxj');

        const attached = await attachJournalHistory(
          source.store,
          destination.store,
          { replace: false, owner: 1, isCancelled: () => false },
        );

        expect(await texts(destination)).toStrictEqual([
          'one-a',
          'shared',
          'one-b',
        ]);
        expect(await owners(destination)).toStrictEqual([1, 0, 1]);
        expect(attached).toMatchObject({
          committedRows: 3,
          destinationRewound: false,
        });
      }));

    it('maps owners through their origins when the two journals number them differently', () =>
      withCleanup(async () => {
        const source = await seededSource();
        const destination = await session('destination.llxj');
        await registerOwners(destination, ['agent:two', 'agent:three']);

        await attachJournalHistory(source.store, destination.store, {
          replace: false,
          isCancelled: () => false,
        });

        expect(await texts(destination)).toStrictEqual([
          'one-a',
          'shared',
          'two-a',
          'one-b',
        ]);
        expect(await originsOf(destination)).toStrictEqual([
          'agent:one',
          undefined,
          'agent:two',
          'agent:one',
        ]);
        // The destination keeps its own numbering; the origin it did not have gets the next id.
        const dictionary = await OwnerDictionary.load(destination.store);
        expect(dictionary.idOf('agent:two')).toBe(1);
        expect(dictionary.idOf('agent:three')).toBe(2);
        expect(dictionary.idOf('agent:one')).toBe(3);
      }));

    it('registers only the origin of the owner it takes when it filters by owner', () =>
      withCleanup(async () => {
        const source = await seededSource();
        const destination = await session('destination.llxj');
        await registerOwners(destination, ['agent:two']);

        await attachJournalHistory(source.store, destination.store, {
          replace: false,
          owner: 1,
          isCancelled: () => false,
        });

        expect(await originsOf(destination)).toStrictEqual([
          'agent:one',
          undefined,
          'agent:one',
        ]);
        const dictionary = await OwnerDictionary.load(destination.store);
        expect(dictionary.idOf('agent:one')).toBe(2);
        expect(dictionary.originOf(3)).toBeUndefined();
      }));

    it('refuses a row whose owner the source dictionary does not name', () =>
      withCleanup(async () => {
        const source = await session('source.llxj');
        await source.append([row('stray')], { owner: 7 });
        const destination = await session('destination.llxj');

        const attempt = attachJournalHistory(source.store, destination.store, {
          replace: false,
          isCancelled: () => false,
        });

        await expect(attempt).rejects.toBeInstanceOf(HistoryAttachmentError);
        expect(await texts(destination)).toStrictEqual([]);
      }));

    it('refuses a destination that holds history unless it is to be replaced', () =>
      withCleanup(async () => {
        const source = await seededSource();
        const destination = await session('destination.llxj');
        await destination.append([row('existing')]);

        const attempt = attachJournalHistory(source.store, destination.store, {
          replace: false,
          isCancelled: () => false,
        });

        await expect(attempt).rejects.toBeInstanceOf(HistoryAttachmentError);
        await expect(attempt).rejects.toMatchObject({
          committedRows: 0,
          destinationRewound: false,
        });
        expect(await texts(destination)).toStrictEqual(['existing']);
      }));

    it('leaves the previous history when the destination write fails', () =>
      withCleanup(async () => {
        const source = await seededSource();
        const failures: Failures = {};
        const seams = testJournalSeams(failures);
        const destination = await JournalSession.create(
          path.join(directory(), 'destination.llxj'),
          { journal: seams.dependencies },
        );
        open.push(destination);
        await destination.append([row('existing destination')]);
        failures.failWriteAt = seams.events.filter(
          (event) => event.type === 'write',
        ).length;
        const before = await fsp.readFile(destination.path);

        const attempt = attachJournalHistory(source.store, destination.store, {
          replace: true,
          isCancelled: () => false,
        });

        await expect(attempt).rejects.toMatchObject({
          committedRows: 0,
          destinationRewound: false,
        });
        await expect(attempt).rejects.toBeInstanceOf(HistoryAttachmentError);
        failures.failWriteAt = undefined;
        expect(await texts(destination)).toStrictEqual([
          'existing destination',
        ]);
        expect(
          (await fsp.readFile(destination.path)).length,
        ).toBeGreaterThanOrEqual(before.length);
      }));

    it('writes nothing when the store is disposed while the rows are read', () =>
      withCleanup(async () => {
        const source = await seededSource();
        const destination = await session('destination.llxj');
        await destination.append([row('existing')]);
        let checks = 0;

        const attempt = attachJournalHistory(source.store, destination.store, {
          replace: true,
          isCancelled: () => checks++ >= 2,
        });

        await expect(attempt).rejects.toBeInstanceOf(HistoryAttachmentError);
        await expect(attempt).rejects.toThrow(
          'History journal store is disposed',
        );
        expect(await texts(destination)).toStrictEqual(['existing']);
      }));
  });
});
