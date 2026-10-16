/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import type { VersionEdit } from './groupEdits.js';
import { JournalStore } from './journalStore.js';
import { MUTATION } from './recordKinds.js';
import type { RowDraft } from './rowDraft.js';
import {
  appendEach,
  draftRow,
  scenarioDrafts,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import {
  snapshotStore,
  type StoreSnapshot,
} from './__tests__/support/storeSnapshot.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const IDS = ['a', 'b', 'c', 'd', 'e'] as const;
const OWNERS = [1, 2, 1, 2, 3, 0] as const;

/** The draft with its `owner` property gone, which the type refuses and a caller from untyped code could still hand over. */
function withoutOwner(draft: RowDraft): RowDraft {
  const copy = { ...draft };
  Reflect.deleteProperty(copy, 'owner');
  return copy;
}

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

async function liveLabels(store: JournalStore): Promise<bigint[]> {
  const labels: bigint[] = [];
  for await (const entry of store.rows()) labels.push(entry.label);
  return labels;
}

describe('the owner of a row is required (design 5.1)', () => {
  const directory = useTempDir('journal-owner-');
  const file = (name: string) => path.join(directory(), name);

  /** One edit per kind that carries a row draft, each with the draft missing its owner. */
  function ownerlessEdits(
    labels: readonly bigint[],
  ): Array<[string, VersionEdit]> {
    const bare = withoutOwner(draftRow({ text: 'ownerless' }));
    return [
      ['append', { kind: 'append', rows: [bare] }],
      ['replace of an array', { kind: 'replace', rows: [bare] }],
      [
        'replace of a stream',
        {
          kind: 'replace',
          rows: (async function* (): AsyncGenerator<RowDraft> {
            yield bare;
          })(),
        },
      ],
      [
        'compress',
        {
          kind: 'compress',
          summary: bare,
          retainFromLabel: labels[3],
          expectedReplaced: 3,
        },
      ],
      [
        'density',
        {
          kind: 'density',
          replacements: [{ label: labels[2], draft: bare }],
          removed: [],
        },
      ],
      ['purge', { kind: 'purge', rows: [{ label: labels[1], draft: bare }] }],
      ['insert', { kind: 'insert', afterLabel: labels[1], draft: bare }],
    ];
  }

  it('refuses a row draft without an owner in every edit that carries one, writes nothing, and leaves the store usable', async () => {
    const store = await ownedStore(file('required.llxj'));
    const labels = await liveLabels(store);
    const before = await snapshotStore(store, IDS);
    const size = (await fsp.stat(file('required.llxj'))).size;
    const edits = ownerlessEdits(labels);

    for (const [name, edit] of edits) {
      const outcome = await store.commit([edit]).then(
        () => 'committed',
        (error: unknown) => error,
      );
      expect({
        name,
        refused: outcome instanceof JournalFormatError,
      }).toStrictEqual({
        name,
        refused: true,
      });
      expect(String(outcome)).toContain('owner');
      expect(await snapshotStore(store, IDS)).toStrictEqual(before);
      expect((await fsp.stat(file('required.llxj'))).size).toBe(size);
    }

    await store.commit([
      {
        kind: 'append',
        rows: [draftRow({ owner: 0, text: 'after refusals' })],
      },
    ]);
    expect(store.published?.rows).toBe(before.rows.length + 1);
    expect(edits).toHaveLength(7);
    await store.close();

    const reopened = await JournalStore.open(
      file('required.llxj'),
      storeDeps(),
    );
    expect(reopened.published?.rows).toBe(before.rows.length + 1);
    await reopened.close();
  });

  it('accepts unowned as the explicit owner 0, and refuses an owner outside 0 to 2^32 - 1', async () => {
    const store = await ownedStore(file('range.llxj'));
    const labels = await liveLabels(store);
    const before = await snapshotStore(store, IDS);

    for (const owner of [-1, 1.5, 2 ** 32, Number.NaN]) {
      await expect(
        store.commit([
          { kind: 'owner', changes: [{ label: labels[0], owner }] },
        ]),
      ).rejects.toBeInstanceOf(JournalFormatError);
      await expect(
        store.commit([
          { kind: 'append', rows: [{ ...draftRow({ text: 'x' }), owner }] },
        ]),
      ).rejects.toBeInstanceOf(JournalFormatError);
      expect(await snapshotStore(store, IDS)).toStrictEqual(before);
    }

    await store.commit([
      { kind: 'owner', changes: [{ label: labels[0], owner: 0 }] },
    ]);
    await store.commit([
      {
        kind: 'owner',
        changes: [{ label: labels[0], owner: 2 ** 32 - 1 }],
      },
    ]);
    const after = await snapshotStore(store, IDS);
    expect(after.rows[0].entry.owner).toBe(2 ** 32 - 1);
    await store.close();
  });
});

describe('an owner change (design 4.6 and 5.4)', () => {
  const directory = useTempDir('journal-owner-change-');
  const file = (name: string) => path.join(directory(), name);

  interface Change {
    readonly before: StoreSnapshot;
    readonly after: StoreSnapshot;
    readonly bytesBefore: Uint8Array;
    readonly bytesAfter: Uint8Array;
    readonly expectedOwners: readonly number[];
  }

  /** Changes three rows: a middle one to 9, one to unowned, and the last one to 4. */
  async function changeOwners(name: string): Promise<Change> {
    const store = await ownedStore(file(name));
    const labels = await liveLabels(store);
    const before = await snapshotStore(store, IDS);
    const bytesBefore = new Uint8Array(await fsp.readFile(file(name)));
    await store.commit([
      {
        kind: 'owner',
        changes: [
          { label: labels[1], owner: 9 },
          { label: labels[4], owner: 0 },
          { label: labels[5], owner: 4 },
        ],
      },
    ]);
    const after = await snapshotStore(store, IDS);
    await store.close();
    return {
      before,
      after,
      bytesBefore,
      bytesAfter: new Uint8Array(await fsp.readFile(file(name))),
      expectedOwners: [1, 9, 1, 2, 0, 4],
    };
  }

  it('changes the owner of the entries and nothing else about them', async () => {
    const change = await changeOwners('entries.llxj');

    expect(change.after.rows.map((row) => row.entry.owner)).toStrictEqual([
      ...change.expectedOwners,
    ]);
    for (const [index, row] of change.after.rows.entries()) {
      expect(row.entry).toStrictEqual({
        ...change.before.rows[index].entry,
        owner: change.expectedOwners[index],
      });
    }
    expect(change.after.aggregate).toStrictEqual({
      ...change.before.aggregate,
      ownerBloom: change.expectedOwners.reduce(
        (bloom, owner) => bloom | (1n << BigInt(owner)),
        0n,
      ),
    });
  });

  it('does not rewrite a row: the bytes of the file before the group are the same, and every row reads back as it was written', async () => {
    const change = await changeOwners('bytes.llxj');

    expect(change.bytesAfter.length).toBeGreaterThan(change.bytesBefore.length);
    expect(
      change.bytesAfter.subarray(0, change.bytesBefore.length),
    ).toStrictEqual(change.bytesBefore);
    for (const [index, row] of change.after.rows.entries()) {
      const was = change.before.rows[index];
      expect(row.entry.recordOffset).toBe(was.entry.recordOffset);
      expect(row.entry.recordLength).toBe(was.entry.recordLength);
      expect({ ids: row.rawIds, text: row.text }).toStrictEqual({
        ids: was.rawIds,
        text: was.text,
      });
    }
  });

  it('leaves the facts, the id trie and the meta map exactly as they were', async () => {
    const change = await changeOwners('facts.llxj');

    expect(change.after.facts).toStrictEqual(change.before.facts);
    expect(change.after.meta).toStrictEqual(change.before.meta);
    expect(change.after.roots.idRoot).toBe(change.before.roots.idRoot);
    expect(change.after.roots.metaRoot).toBe(change.before.roots.metaRoot);
    expect(change.after.roots.rowRoot).not.toBe(change.before.roots.rowRoot);
    expect(change.after.nextLabel).toBe(change.before.nextLabel);
  });

  it('starts a new lineage with itself as its first version', async () => {
    const change = await changeOwners('lineage.llxj');

    expect(change.after.lineage).not.toBe(change.before.lineage);
    expect(change.after.lineage).toBe(BigInt(change.after.commitSeq));
    expect(change.after.parent).toBe(0);
    expect(change.after.lineageDepth).toBe(0);
    const reopened = await JournalStore.open(file('lineage.llxj'), storeDeps());
    expect(reopened.published?.mutation).toBe(MUTATION.owner);
    expect(reopened.published?.lastOwner).toBe(4);
    expect(await snapshotStore(reopened, IDS)).toStrictEqual(change.after);
    await reopened.close();
  });

  it('refuses a label that is not live, and an empty change', async () => {
    const store = await ownedStore(file('missing.llxj'));
    const before = await snapshotStore(store, IDS);

    await expect(
      store.commit([{ kind: 'owner', changes: [{ label: 12345n, owner: 1 }] }]),
    ).rejects.toBeInstanceOf(JournalFormatError);
    await expect(
      store.commit([{ kind: 'owner', changes: [] }]),
    ).rejects.toBeInstanceOf(JournalFormatError);
    expect(await snapshotStore(store, IDS)).toStrictEqual(before);
    await appendEach(store, [draftRow({ owner: 3 })]);
    expect(store.published?.rows).toBe(before.rows.length + 1);
    await store.close();
  });
});
