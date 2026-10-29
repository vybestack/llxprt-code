/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { openJournalReadOnly } from './journalReader.js';
import { JournalStore } from './journalStore.js';
import { MUTATION, RECORD_KIND } from './recordKinds.js';
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
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function published(store: JournalStore) {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

describe('commit groups', () => {
  const directory = useTempDir('journal-commit-');
  const file = (name: string) => path.join(directory(), name);

  it('append rows with their id facts, and reopen to the same version', async () => {
    const target = file('append.llxj');
    const store = await JournalStore.create(target, storeDeps());
    const model = new ArrayModel();
    await appendEach(store, scenarioDrafts());
    model.append(6);
    expect(await labelsOf(store)).toStrictEqual([...model.liveLabels]);
    const facts = await factSnapshot(store);
    const meta = await metaSnapshot(store);
    const version = published(store);
    expect(version.mutation).toBe(MUTATION.append);
    expect(version.rows).toBe(6);
    expect(version.firstLabel).toBe(model.liveLabels[0]);
    const queries = await store.idFacts();
    try {
      const fact = await queries.fact('a');
      expect(fact?.callCount).toBe(1);
      expect(fact?.respCount).toBe(1);
    } finally {
      await queries.close();
    }
    await store.close();

    const reopened = await JournalStore.open(target, storeDeps());
    expect(published(reopened).commitSeq).toBe(version.commitSeq);
    expect(published(reopened).groupTag).toBe(version.groupTag);
    expect(await labelsOf(reopened)).toStrictEqual([...model.liveLabels]);
    expect(await factSnapshot(reopened)).toStrictEqual(facts);
    expect(await metaSnapshot(reopened)).toStrictEqual(meta);
    // The reopened store carries on from the right label and lineage.
    const [next] = model.append(1);
    await reopened.commit([{ kind: 'append', rows: [draftRow()] }]);
    const labels = await labelsOf(reopened);
    expect(labels[labels.length - 1]).toBe(next);
    expect(published(reopened).parent).toBe(version.selfOffset);
    await reopened.close();
  });

  it('does not publish a version before its trailer is acked (defect 1)', async () => {
    const target = file('ack.llxj');
    const seams = testJournalSeams({ gateTrailerAt: 1, recordKinds: true });
    const store = await JournalStore.create(target, storeDeps({ seams }));
    await store.commit([{ kind: 'append', rows: [draftRow()] }]);
    const first = published(store);
    const model = new ArrayModel();
    model.append(1);

    const second = store.commit([
      { kind: 'append', rows: [draftRow({ text: 'second' })] },
    ]);
    // The group's records are written and flushed; its trailer write is held.
    for (let spin = 0; spin < 500; spin++) {
      if (
        seams.events.filter(
          (event) =>
            event.type === 'write' && event.kind === RECORD_KIND.TRAILER,
        ).length === 2
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    expect(seams.events.filter((event) => event.type === 'flush')).toHaveLength(
      2,
    );
    expect(store.published).toBe(first);
    expect(published(store).commitSeq).toBe(1);
    expect(await labelsOf(store)).toStrictEqual([...model.liveLabels]);
    const outside = await openJournalReadOnly(target);
    expect(outside.trailer?.commitSeq).toBe(1);
    await outside.close();

    seams.release();
    await second;
    expect(published(store).commitSeq).toBe(2);
    expect(await labelsOf(store)).toHaveLength(2);
    await store.close();
  });

  it('keeps the published version when a flush fails, and refuses later groups', async () => {
    const seams = testJournalSeams({ failFlushAt: 1 });
    const store = await JournalStore.create(
      file('flush.llxj'),
      storeDeps({ seams }),
    );
    await store.commit([{ kind: 'append', rows: [draftRow()] }]);
    const first = published(store);
    await expect(
      store.commit([{ kind: 'append', rows: [draftRow()] }]),
    ).rejects.toThrow(/injected flush failure/);
    expect(store.published).toBe(first);
    await expect(
      store.commit([{ kind: 'append', rows: [draftRow()] }]),
    ).rejects.toThrow(/failed earlier/);
    expect(await labelsOf(store)).toHaveLength(1);
    await store.close();
  });

  it('checkpoint create writes one state-only group whose size does not depend on the history', async () => {
    const sizes: number[] = [];
    for (const rows of [20, 600]) {
      const target = file(`ckpt-${rows}.llxj`);
      const store = await JournalStore.create(target, storeDeps());
      const drafts = Array.from({ length: rows }, () => draftRow());
      for (let at = 0; at < drafts.length; at += 50) {
        await store.commit([
          { kind: 'append', rows: drafts.slice(at, at + 50) },
        ]);
      }
      await store.commit([
        { kind: 'checkpoint', id: 'first', name: 'one', createdAtMs: 1 },
      ]);
      const before = published(store);
      const sizeBefore = (await fsp.stat(target)).size;

      await store.commit([
        { kind: 'checkpoint', id: 'second', name: 'two', createdAtMs: 2 },
      ]);

      const after = published(store);
      sizes.push((await fsp.stat(target)).size - sizeBefore);
      expect(after.mutation).toBe(MUTATION.state);
      expect(after.roots.rowRoot).toBe(before.roots.rowRoot);
      expect(after.roots.idRoot).toBe(before.roots.idRoot);
      expect(after.roots.metaRoot).toBe(before.roots.metaRoot);
      expect(after.roots.stateRoot).not.toBe(before.roots.stateRoot);
      expect(after.rows).toBe(rows);
      expect(after.lineage).toBe(before.lineage);
      expect(after.parent).toBe(before.selfOffset);
      expect(after.ckptBytes).toBe(
        before.ckptBytes + before.aggregate.liveBytes,
      );
      expect(await store.getState('ckpt:first')).toBeDefined();
      await store.close();
    }
    expect(sizes[0]).toBeLessThan(4096);
    // Only the digits of the recorded `liveBytes` differ between the two histories.
    expect(Math.abs(sizes[1] - sizes[0])).toBeLessThan(32);
  });

  it('refuses a checkpoint in a group that also changes rows', async () => {
    const store = await JournalStore.create(file('mixed.llxj'), storeDeps());
    await store.commit([{ kind: 'append', rows: [draftRow()] }]);
    await expect(
      store.commit([
        { kind: 'append', rows: [draftRow()] },
        { kind: 'checkpoint', id: 'x', name: 'x', createdAtMs: 1 },
      ]),
    ).rejects.toThrow(/changes only the state map/);
    expect(published(store).rows).toBe(1);
    await store.close();
  });

  it('restore takes the roots of a saved version and the current state map, in a new lineage', async () => {
    const store = await JournalStore.create(file('restore.llxj'), storeDeps());
    const drafts = scenarioDrafts();
    const model = new ArrayModel();
    await appendEach(store, drafts.slice(0, 3));
    const labels = model.append(3);
    const saved = published(store);
    const savedFacts = await factSnapshot(store);
    const savedMeta = await metaSnapshot(store);
    await appendEach(store, drafts.slice(3, 6));
    model.append(3);
    await store.commit([
      {
        kind: 'setState',
        key: 'title',
        value: new TextEncoder().encode('later'),
      },
    ]);

    await store.commit([{ kind: 'restore', saved }]);

    const now = published(store);
    expect(now.mutation).toBe(MUTATION.restore);
    expect(await labelsOf(store)).toStrictEqual(labels);
    expect(await factSnapshot(store)).toStrictEqual(savedFacts);
    expect(await metaSnapshot(store)).toStrictEqual(savedMeta);
    expect(new TextDecoder().decode(await store.getState('title'))).toBe(
      'later',
    );
    expect(now.parent).toBe(0);
    expect(now.lineageDepth).toBe(0);
    expect(now.lineage).toBe(BigInt(now.commitSeq));
    expect(now.lineage).not.toBe(saved.lineage);
    expect(now.nextLabel).toBe(model.nextLabel);
    expect(now.roots.rowRoot).toBe(saved.roots.rowRoot);
    await store.close();
  });

  it('refuses to restore a version that is not the one in the file', async () => {
    const store = await JournalStore.create(file('forged.llxj'), storeDeps());
    await appendEach(store, scenarioDrafts().slice(0, 2));
    const real = published(store);
    await expect(
      store.commit([
        { kind: 'restore', saved: { ...real, groupTag: real.groupTag + 1n } },
      ]),
    ).rejects.toThrow(/is not the one in the file/);
    expect(published(store).commitSeq).toBe(real.commitSeq);
    await store.close();
  });

  it('refuses an empty group and a group that both clears and restores', async () => {
    const store = await JournalStore.create(file('shape.llxj'), storeDeps());
    await store.commit([{ kind: 'append', rows: [draftRow()] }]);
    const saved = published(store);
    await expect(store.commit([])).rejects.toThrow(/at least one edit/);
    await expect(
      store.commit([{ kind: 'clear' }, { kind: 'restore', saved }]),
    ).rejects.toThrow(/both clear and restore/);
    await store.close();
  });
});
