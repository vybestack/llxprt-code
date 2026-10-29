/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalStore } from './journalStore.js';
import { MUTATION } from './recordKinds.js';
import type { RowEntry } from './rowEntry.js';
import {
  ArrayModel,
  appendEach,
  draftRow,
  factSnapshot,
  labelsOf,
  metaSnapshot,
  scenarioDrafts,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function entriesOf(store: JournalStore): Promise<RowEntry[]> {
  const entries: RowEntry[] = [];
  for await (const entry of store.rows()) entries.push(entry);
  return entries;
}

function published(store: JournalStore) {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

/** A store built by appending the first `count` scenario rows, one group each. */
async function referenceStore(
  file: string,
  count: number,
): Promise<JournalStore> {
  const store = await JournalStore.create(file, storeDeps());
  await appendEach(store, scenarioDrafts().slice(0, count));
  return store;
}

describe('pop', () => {
  const directory = useTempDir('journal-pop-');
  const file = (name: string) => path.join(directory(), name);

  it('inside a group re-appends the kept rows of that group and writes no row record again', async () => {
    const store = await JournalStore.create(file('inside.llxj'), storeDeps());
    const drafts = scenarioDrafts();
    const model = new ArrayModel();
    await appendEach(store, drafts.slice(0, 1));
    model.append(1);
    const before0 = published(store);
    // One group of four rows; the cut falls inside it.
    await store.commit([{ kind: 'append', rows: drafts.slice(1, 5) }]);
    const labels = model.append(4);
    const before = await entriesOf(store);
    const anchor = published(store);
    const cut = labels[2];
    const removed = model.popFrom(cut);
    expect(removed).toBe(2);

    await store.commit([
      { kind: 'pop', cutLabel: cut, expectedRemoved: removed },
    ]);

    expect(await labelsOf(store)).toStrictEqual([...model.liveLabels]);
    const after = await entriesOf(store);
    expect(after.map((entry) => entry.recordOffset)).toStrictEqual(
      before.slice(0, after.length).map((entry) => entry.recordOffset),
    );
    const now = published(store);
    expect(now.lineage).toBe(anchor.lineage);
    expect(now.mutation).toBe(MUTATION.pop);
    expect(now.mutationArg0).toBe(cut);
    expect(now.mutationArg1).toBe(2n);
    expect(now.parent).toBe(before0.selfOffset);
    expect(now.lineageDepth).toBe(before0.lineageDepth + 1);
    const reference = await referenceStore(file('inside-ref.llxj'), 3);
    expect(await factSnapshot(store)).toStrictEqual(
      await factSnapshot(reference),
    );
    expect(await metaSnapshot(store)).toStrictEqual(
      await metaSnapshot(reference),
    );
    await reference.close();
    await store.close();
  });

  it('inside one group removes rows that were never written', async () => {
    const store = await JournalStore.create(file('same.llxj'), storeDeps());
    const drafts = scenarioDrafts();
    await appendEach(store, drafts.slice(0, 1));
    const model = new ArrayModel();
    model.append(1);
    const labels = model.append(3);
    const removed = model.popFrom(labels[2]);
    await store.commit([
      { kind: 'append', rows: drafts.slice(1, 4) },
      { kind: 'pop', cutLabel: labels[2], expectedRemoved: removed },
    ]);
    expect(await labelsOf(store)).toStrictEqual([...model.liveLabels]);
    expect(published(store).nextLabel).toBe(labels[2] + (1n << 20n));
    const reference = await referenceStore(file('same-ref.llxj'), 3);
    expect(await factSnapshot(store)).toStrictEqual(
      await factSnapshot(reference),
    );
    await reference.close();
    await store.close();
  });

  it('below a lineage start rebuilds in a new lineage and never reaches an older one', async () => {
    const store = await JournalStore.create(file('below.llxj'), storeDeps());
    const drafts = scenarioDrafts();
    const model = new ArrayModel();
    await appendEach(store, drafts.slice(0, 2));
    const [first, second] = model.append(2);
    const saved = published(store);
    // An older lineage whose row counts a walk across the start would find.
    await store.commit([{ kind: 'clear' }]);
    model.clear();
    await appendEach(store, drafts.slice(2, 4));
    model.append(2);
    const oldLineage = published(store).lineage;

    await store.commit([{ kind: 'restore', saved }]);
    model.replaceWith([first, second]);
    await store.commit([{ kind: 'append', rows: [drafts[4]] }]);
    model.append(1);
    expect(published(store).lineageDepth).toBe(1);

    const removed = model.popFrom(second);
    expect(removed).toBe(2);
    await store.commit([
      { kind: 'pop', cutLabel: second, expectedRemoved: removed },
    ]);

    expect(await labelsOf(store)).toStrictEqual([first]);
    const now = published(store);
    expect(now.parent).toBe(0);
    expect(now.lineageDepth).toBe(0);
    expect(now.lineage).not.toBe(oldLineage);
    expect(now.lineage).not.toBe(saved.lineage);
    const reference = await referenceStore(file('below-ref.llxj'), 1);
    expect(await factSnapshot(store)).toStrictEqual(
      await factSnapshot(reference),
    );
    expect(await metaSnapshot(store)).toStrictEqual(
      await metaSnapshot(reference),
    );
    await reference.close();
    await store.close();
  });

  it('after a self-merge removes exactly the rows from the second row of a shared chronology seq (defect 2)', async () => {
    const store = await JournalStore.create(file('merge.llxj'), storeDeps());
    const drafts = [
      draftRow({ text: 'a', chronologySeq: 5n }),
      draftRow({ text: 'b', chronologySeq: 7n }),
      draftRow({ text: 'merged', chronologySeq: 7n }),
      draftRow({ text: 'after', chronologySeq: 9n }),
    ];
    await appendEach(store, drafts);
    const model = new ArrayModel();
    const [, secondRow, mergedRow] = model.append(4);
    const seqs = (await entriesOf(store)).map((entry) => entry.chronologySeq);
    expect(seqs.slice(1, 3)).toStrictEqual([7n, 7n]);

    // The retired fold cut at the first row that carries the seq.
    const firstWithSeq = (await entriesOf(store)).findIndex(
      (entry) => entry.chronologySeq === 7n,
    );
    const retiredKeep = firstWithSeq;
    const removed = model.popFrom(mergedRow);
    expect(removed).toBe(2);
    expect(model.liveLabels.length).not.toBe(retiredKeep);

    await store.commit([
      { kind: 'pop', cutLabel: mergedRow, expectedRemoved: removed },
    ]);

    expect(await labelsOf(store)).toStrictEqual([...model.liveLabels]);
    expect(await labelsOf(store)).toContain(secondRow);
    expect(
      (await entriesOf(store)).map((entry) => entry.chronologySeq),
    ).toStrictEqual([5n, 7n]);
    await store.close();
  });

  it('restores the meta map of the version it lands on and keeps the state map (checkpoint survives)', async () => {
    const store = await JournalStore.create(file('meta.llxj'), storeDeps());
    const drafts = scenarioDrafts();
    await appendEach(store, drafts.slice(0, 4));
    const model = new ArrayModel();
    const labels = model.append(4);
    const beforeCheckpoint = published(store);
    expect(await metaSnapshot(store)).toStrictEqual([
      '1',
      labels[1].toString(),
      'none',
      '1',
      labels[3].toString(),
      'none',
    ]);

    await store.commit([
      { kind: 'checkpoint', id: 'c1', name: 'before pop', createdAtMs: 123 },
    ]);
    const stateRootBefore = published(store).roots.stateRoot;
    await store.commit([
      {
        kind: 'setState',
        key: 'title',
        value: new TextEncoder().encode('kept'),
      },
    ]);
    const removed = model.popFrom(labels[3]);
    await store.commit([
      { kind: 'pop', cutLabel: labels[3], expectedRemoved: removed },
    ]);

    const now = published(store);
    expect(await metaSnapshot(store)).toStrictEqual([
      '1',
      labels[1].toString(),
      'none',
      'none',
      'none',
      'none',
    ]);
    expect(now.roots.stateRoot).not.toBe(stateRootBefore);
    const checkpoint = await store.getState('ckpt:c1');
    expect(JSON.parse(new TextDecoder().decode(checkpoint))).toStrictEqual({
      name: 'before pop',
      trailerOffset: beforeCheckpoint.selfOffset,
      commitSeq: beforeCheckpoint.commitSeq,
      createdAtMs: 123,
      liveBytes: beforeCheckpoint.aggregate.liveBytes,
    });
    expect(new TextDecoder().decode(await store.getState('title'))).toBe(
      'kept',
    );
    // The version the checkpoint names is still readable after the pop.
    const named = await store.readVersion(beforeCheckpoint.selfOffset);
    expect(named.rows).toBe(4);
    await store.close();
  });

  it('refuses a pop whose expected count is wrong and leaves the store usable', async () => {
    const store = await JournalStore.create(file('wrong.llxj'), storeDeps());
    await appendEach(store, scenarioDrafts().slice(0, 3));
    const model = new ArrayModel();
    const labels = model.append(3);
    const before = published(store);
    await expect(
      store.commit([{ kind: 'pop', cutLabel: labels[1], expectedRemoved: 1 }]),
    ).rejects.toThrow(/removes 2 rows, not the expected 1/);
    expect(published(store).commitSeq).toBe(before.commitSeq);
    await store.commit([
      { kind: 'pop', cutLabel: labels[1], expectedRemoved: 2 },
    ]);
    expect(await labelsOf(store)).toStrictEqual([labels[0]]);
    await store.close();
  });

  it('clear, then append, then pop returns to the cleared version and never reuses a label', async () => {
    const store = await JournalStore.create(file('clear.llxj'), storeDeps());
    const drafts = scenarioDrafts();
    const model = new ArrayModel();
    await appendEach(store, drafts.slice(0, 3));
    model.append(3);
    await store.commit([{ kind: 'clear' }]);
    model.clear();
    const cleared = published(store);
    expect(cleared.mutation).toBe(MUTATION.clear);
    expect(cleared.rows).toBe(0);
    expect(cleared.roots.rowRoot).toBe(0);
    expect(cleared.parent).toBe(0);

    await appendEach(store, drafts.slice(3, 6));
    const labels = model.append(3);
    expect(labels[0]).toBe((1n << 20n) * 4n);
    expect(await labelsOf(store)).toStrictEqual([...model.liveLabels]);

    const removed = model.popFrom(labels[0]);
    expect(removed).toBe(3);
    await store.commit([
      { kind: 'pop', cutLabel: labels[0], expectedRemoved: removed },
    ]);
    const now = published(store);
    expect(await labelsOf(store)).toStrictEqual([]);
    expect(now.roots.rowRoot).toBe(0);
    expect(now.roots.idRoot).toBe(0);
    expect(now.roots.metaRoot).toBe(0);
    expect(now.lineage).toBe(cleared.lineage);
    expect(now.nextLabel).toBe(model.nextLabel);

    await appendEach(store, drafts.slice(0, 1));
    expect((await labelsOf(store))[0]).toBe(model.nextLabel);
    await store.close();
  });
});
