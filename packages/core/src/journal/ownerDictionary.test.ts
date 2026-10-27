/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import { JournalStore } from './journalStore.js';
import { OwnerDictionary } from './ownerDictionary.js';
import { accepts, ownerBloomBit } from './ownerRules.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('owner dictionary (design 5.1)', () => {
  const directory = useTempDir('journal-owner-dict-');
  const file = (name: string) => path.join(directory(), name);

  /** Registers `origin` in the group of one row that it owns. */
  async function appendOwned(
    store: JournalStore,
    dictionary: OwnerDictionary,
    origin: string,
  ): Promise<number> {
    const registration = dictionary.prepare(origin);
    await store.commit([
      ...registration.edits,
      { kind: 'append', rows: [draftRow({ owner: registration.id })] },
    ]);
    dictionary.confirm(registration);
    return registration.id;
  }

  it('hands out ids from 1 in order, finds a known origin again, and is read back from the file', async () => {
    const store = await JournalStore.create(file('a.llxj'), storeDeps());
    const dictionary = await OwnerDictionary.load(store);
    expect(dictionary.idOf('main')).toBeUndefined();

    const first = await appendOwned(store, dictionary, 'main');
    const second = await appendOwned(store, dictionary, 'subagent:one');
    expect([first, second]).toStrictEqual([1, 2]);
    expect(dictionary.prepare('main')).toStrictEqual({
      id: 1,
      origin: 'main',
      edits: [],
    });
    await store.close();

    const reopened = await JournalStore.open(file('a.llxj'), storeDeps());
    const loaded = await OwnerDictionary.load(reopened);
    expect([
      loaded.originOf(1),
      loaded.originOf(2),
      loaded.idOf('main'),
    ]).toStrictEqual(['main', 'subagent:one', 1]);
    await reopened.close();
  });

  it('does not hand off different owners that share a bloom bit', async () => {
    const store = await JournalStore.create(
      file('handoff-collision.llxj'),
      storeDeps(),
    );
    try {
      const dictionary = await OwnerDictionary.load(store);
      for (let id = 1; id <= 65; id++)
        await appendOwned(store, dictionary, `runtime-${id}`);
      await store.commit([
        {
          kind: 'replace',
          rows: [draftRow({ owner: 1 }), draftRow({ owner: 65 })],
        },
      ]);
      expect(
        dictionary.handoff(
          'next-runtime',
          store.published?.aggregate.ownerBloom ?? 0n,
        ),
      ).toStrictEqual([]);
      expect([dictionary.originOf(1), dictionary.originOf(65)]).toStrictEqual([
        'runtime-1',
        'runtime-65',
      ]);
      expect(dictionary.idOf('next-runtime')).toBeUndefined();
    } finally {
      await store.close();
    }
  });

  it('hands off the sole live owner without reusing an inactive owner id', async () => {
    const store = await JournalStore.create(file('handoff.llxj'), storeDeps());
    try {
      const dictionary = await OwnerDictionary.load(store);
      await appendOwned(store, dictionary, 'inactive-runtime');
      const live = await appendOwned(store, dictionary, 'previous-runtime');
      expect(
        dictionary.handoff(
          'next-runtime',
          store.published?.aggregate.ownerBloom ?? 0n,
        ),
      ).toStrictEqual([]);
      await store.commit([
        { kind: 'replace', rows: [draftRow({ owner: live })] },
      ]);
      await store.commit([
        ...dictionary.handoff(
          'next-runtime',
          store.published?.aggregate.ownerBloom ?? 0n,
        ),
      ]);
      const loaded = await OwnerDictionary.load(store);
      expect([
        loaded.originOf(1),
        loaded.originOf(live),
        loaded.prepare('third-runtime').id,
      ]).toStrictEqual(['inactive-runtime', 'next-runtime', 3]);
    } finally {
      await store.close();
    }
  });

  it('survives a pop below the group that registered an origin, and never reuses its id', async () => {
    const store = await JournalStore.create(file('b.llxj'), storeDeps());
    const dictionary = await OwnerDictionary.load(store);
    await appendOwned(store, dictionary, 'main');
    const cut = store.published?.nextLabel;
    if (cut === undefined) throw new Error('nothing is published');
    await appendOwned(store, dictionary, 'subagent:one');

    await store.commit([{ kind: 'pop', cutLabel: cut, expectedRemoved: 1 }]);
    expect(store.published?.rows).toBe(1);

    const reloaded = await OwnerDictionary.load(store);
    expect(reloaded.originOf(2)).toBe('subagent:one');
    const third = await appendOwned(store, reloaded, 'subagent:two');
    expect(third).toBe(3);
    await store.close();
  });

  it('refuses a registration that is not the next one, and a file whose entry is missing', async () => {
    const store = await JournalStore.create(file('c.llxj'), storeDeps());
    const dictionary = await OwnerDictionary.load(store);
    const stale = dictionary.prepare('a');
    await appendOwned(store, dictionary, 'b');
    expect(() => dictionary.confirm(stale)).toThrow(JournalFormatError);

    await store.commit([
      {
        kind: 'setState',
        key: 'owner:next',
        value: new TextEncoder().encode('5'),
      },
    ]);
    await expect(OwnerDictionary.load(store)).rejects.toBeInstanceOf(
      JournalFormatError,
    );
    await store.close();
  });

  it('gives another journal the whole dictionary through its state edits', async () => {
    const source = await JournalStore.create(file('d.llxj'), storeDeps());
    const dictionary = await OwnerDictionary.load(source);
    await appendOwned(source, dictionary, 'main');
    await appendOwned(source, dictionary, 'subagent:one');

    const target = await JournalStore.create(file('e.llxj'), storeDeps());
    await target.commit([...dictionary.stateEdits()]);
    const copy = await OwnerDictionary.load(target);
    expect([copy.originOf(1), copy.originOf(2)]).toStrictEqual([
      'main',
      'subagent:one',
    ]);
    expect(copy.prepare('third').id).toBe(3);
    await source.close();
    await target.close();
  });
});

describe('owner acceptance (design 5.2)', () => {
  it('a mirror holds the rows of its owner and the unowned ones', () => {
    expect(accepts(2, 0)).toBe(true);
    expect(accepts(2, 2)).toBe(true);
    expect(accepts(2, 1)).toBe(false);
  });

  it('the bloom bit is the owner id modulo 64', () => {
    expect(ownerBloomBit(0)).toBe(1n);
    expect(ownerBloomBit(65)).toBe(2n);
  });
});
