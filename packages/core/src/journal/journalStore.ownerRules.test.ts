/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import { INHERIT_OWNER } from './groupEdits.js';
import { JournalStore } from './journalStore.js';
import {
  appendEach,
  draftRow,
  scenarioDrafts,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const OWNERS = [1, 2, 1, 2, 3, 0] as const;

async function ownedStore(file: string): Promise<JournalStore> {
  const store = await JournalStore.create(file, storeDeps());
  await appendEach(
    store,
    scenarioDrafts().map((draft, index) => ({
      ...draft,
      owner: OWNERS[index],
    })),
  );
  return store;
}

async function ownersByLabel(
  store: JournalStore,
): Promise<Map<bigint, number>> {
  const owners = new Map<bigint, number>();
  for await (const entry of store.rows()) owners.set(entry.label, entry.owner);
  return owners;
}

async function liveLabels(store: JournalStore): Promise<bigint[]> {
  return [...(await ownersByLabel(store)).keys()];
}

describe('owner of a row that an edit writes (design 5.1)', () => {
  const directory = useTempDir('journal-owner-rules-');
  const file = (name: string) => path.join(directory(), name);

  it('density and purge replacements keep the owner of the entry they replace when they say inherit, and take a named owner, 0 included, otherwise', async () => {
    const store = await ownedStore(file('rewrite.llxj'));
    const [l0, l1, l2, l3, l4] = await liveLabels(store);

    await store.commit([
      {
        kind: 'density',
        replacements: [
          { label: l0, draft: { ...draftRow({}), owner: INHERIT_OWNER } },
          { label: l2, draft: { ...draftRow({}), owner: 0 } },
          { label: l4, draft: { ...draftRow({}), owner: 7 } },
        ],
        removed: [l1],
      },
    ]);
    expect([...(await ownersByLabel(store)).values()]).toStrictEqual([
      1, 0, 2, 7, 0,
    ]);

    await store.commit([
      {
        kind: 'purge',
        rows: [
          { label: l3, draft: { ...draftRow({}), owner: INHERIT_OWNER } },
          { label: l4, draft: { ...draftRow({}), owner: INHERIT_OWNER } },
        ],
      },
    ]);
    expect([...(await ownersByLabel(store)).values()]).toStrictEqual([
      1, 0, 2, 7, 0,
    ]);
    await store.close();
  });

  it('a synthetic insert that says inherit takes the owner of the row it follows, and a named owner wins', async () => {
    const store = await ownedStore(file('insert.llxj'));
    const labels = await liveLabels(store);

    await store.commit([
      {
        kind: 'insert',
        afterLabel: labels[4],
        draft: { ...draftRow({}), owner: INHERIT_OWNER },
      },
    ]);
    await store.commit([
      {
        kind: 'insert',
        afterLabel: labels[1],
        draft: { ...draftRow({}), owner: 0 },
      },
    ]);
    const owners = await ownersByLabel(store);
    expect([...owners.values()]).toStrictEqual([1, 2, 0, 1, 2, 3, 3, 0]);
    await store.close();
  });

  it('inheriting needs a row to inherit from: an insert at the start and a rewrite of a label that is not live both refuse, writing nothing', async () => {
    const store = await ownedStore(file('refuse.llxj'));
    const before = store.published?.commitSeq;

    await expect(
      store.commit([
        {
          kind: 'insert',
          afterLabel: 0n,
          draft: { ...draftRow({}), owner: INHERIT_OWNER },
        },
      ]),
    ).rejects.toBeInstanceOf(JournalFormatError);
    await expect(
      store.commit([
        {
          kind: 'density',
          replacements: [
            {
              label: 12345n,
              draft: { ...draftRow({}), owner: INHERIT_OWNER },
            },
          ],
          removed: [],
        },
      ]),
    ).rejects.toBeInstanceOf(JournalFormatError);
    expect(store.published?.commitSeq).toBe(before);
    await store.close();
  });

  it('restore of a saved version brings back the owners of its entries', async () => {
    const store = await ownedStore(file('restore.llxj'));
    const saved = store.published;
    if (saved === undefined) throw new Error('nothing is published');
    const was = await ownersByLabel(store);
    const labels = await liveLabels(store);

    await store.commit([
      {
        kind: 'owner',
        changes: labels.map((label) => ({ label, owner: 9 })),
      },
    ]);
    expect([...(await ownersByLabel(store)).values()]).toStrictEqual(
      labels.map(() => 9),
    );

    await store.commit([{ kind: 'restore', saved }]);
    expect(await ownersByLabel(store)).toStrictEqual(was);
    await store.close();
  });
});
