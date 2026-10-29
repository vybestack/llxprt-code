/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { realFileOperations } from './compactionSwap.js';
import { JournalStore } from './journalStore.js';
import {
  testJournalSeams,
  type Failures,
} from './__tests__/support/journalFixtures.js';
import {
  draftRow,
  labelsOf,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const RELEASED = 'used after its pin was released';

/** A store whose compaction policy the test switches on, counting the renames of the swap. */
async function pinnedStore(
  file: string,
  failures: Failures = {},
): Promise<{
  store: JournalStore;
  renames: () => number;
  arm: () => void;
}> {
  const seams = testJournalSeams(failures);
  const real = realFileOperations(seams.dependencies.open);
  let renames = 0;
  let armed = false;
  const store = await JournalStore.create(
    file,
    storeDeps({
      seams,
      fileOperations: {
        ...real,
        rename: async (from, to) => {
          renames += 1;
          armed = false;
          await real.rename(from, to);
        },
      },
      compactionDue: () => armed,
    }),
  );
  await store.commit([
    {
      kind: 'append',
      rows: [
        draftRow({ text: 'one', calls: ['a'] }),
        draftRow({ text: 'two', responses: ['a'] }),
        draftRow({ text: 'three' }),
      ],
    },
  ]);
  return {
    store,
    renames: () => renames,
    arm: () => {
      armed = true;
    },
  };
}

const APPEND = [{ kind: 'append' as const, rows: [draftRow()] }];

describe('every offset-based read holds a pin for its lifetime (D-ORCH-6)', () => {
  const directory = useTempDir('journal-store-pins-');
  const file = (name: string) => path.join(directory(), name);

  it('a snapshot defers a compaction requested during it, reads consistent rows, and refuses reads once closed', async () => {
    const { store, renames, arm } = await pinnedStore(file('snapshot.llxj'));
    const snapshot = await store.snapshot();
    const before = await labelsOf(store);
    arm();

    await store.commit(APPEND);
    await store.idle();

    expect(renames()).toBe(0);
    const during: bigint[] = [];
    for await (const entry of snapshot.entries()) during.push(entry.label);
    expect(during).toStrictEqual(before);
    expect(
      (await snapshot.readRow(await snapshot.entryAt(0))).rawIds,
    ).toStrictEqual(['a']);
    await snapshot.close();
    await store.idle();
    expect(renames()).toBe(1);
    await expect(snapshot.entryAt(0)).rejects.toThrow(RELEASED);
    await store.close();
  });

  it('an open read (the only way to record access) defers a compaction and refuses reads once closed', async () => {
    const { store, renames, arm } = await pinnedStore(file('read.llxj'));
    const read = await store.openRead();
    const trailer = read.version?.selfOffset ?? -1;
    arm();

    await store.commit(APPEND);
    await store.idle();

    expect(renames()).toBe(0);
    expect((await read.access.readRecordHead(trailer, 'TRAILER')).offset).toBe(
      trailer,
    );
    await read.close();
    await store.idle();
    expect(renames()).toBe(1);
    expect(() => read.access.readRecordHead(trailer, 'TRAILER')).toThrow(
      RELEASED,
    );
    await store.close();
  });

  it('id facts defer a compaction requested during them, answer consistently, and refuse queries once closed', async () => {
    const { store, renames, arm } = await pinnedStore(file('facts.llxj'));
    const facts = await store.idFacts();
    const before = await facts.fact('a');
    expect(before?.callCount).toBe(1);
    arm();

    await store.commit(APPEND);
    await store.idle();

    expect(renames()).toBe(0);
    expect(await facts.fact('a')).toStrictEqual(before);
    await facts.close();
    await store.idle();
    expect(renames()).toBe(1);
    await expect(facts.fact('a')).rejects.toThrow(RELEASED);
    await store.close();
  });

  it('a committed group keeps its pin from the ack until it is closed, so its records stay readable', async () => {
    const { store, renames, arm } = await pinnedStore(file('group.llxj'));
    arm();

    const group = await store.commitDetailed(APPEND);
    await store.idle();

    expect(renames()).toBe(0);
    const trailer = group.after.selfOffset;
    expect((await group.read.access.readRecordHead(trailer)).offset).toBe(
      trailer,
    );
    expect(group.writtenLabels).toHaveLength(1);
    await group.close();
    await store.idle();
    expect(renames()).toBe(1);
    expect(() => group.read.access.readRecordHead(trailer)).toThrow(RELEASED);
    await store.close();
  });

  it('commit releases its group at once, so it compacts without anyone closing anything', async () => {
    const { store, renames, arm } = await pinnedStore(file('commit.llxj'));
    arm();

    await store.commit(APPEND);
    await store.idle();

    expect(renames()).toBe(1);
    await store.close();
  });

  it('readVersion holds a pin while it reads: a compaction requested meanwhile is refused, and the version it returns is whole', async () => {
    let letReadsRun: () => void = () => undefined;
    const readGate = {
      promise: Promise.resolve(),
      hits: 0,
    };
    const { store } = await pinnedStore(file('version.llxj'), { readGate });
    const published = store.published;
    if (published === undefined) throw new Error('nothing is published');
    readGate.promise = new Promise<void>((resolve) => {
      letReadsRun = resolve;
    });

    const reading = store.readVersion(published.selfOffset);
    while (readGate.hits === 0) await Bun.sleep(1);
    await expect(store.compact()).rejects.toThrow('live pin');
    letReadsRun();

    const version = await reading;
    expect(version.commitSeq).toBe(published.commitSeq);
    expect(version.rows).toBe(3);
    expect(await store.compact()).toBe('swapped');
    await store.close();
  });

  it('releasing a pin twice is a mistake and throws', async () => {
    const { store } = await pinnedStore(file('twice.llxj'));
    const read = await store.openRead();
    await read.close();
    expect(() => read.close()).toThrow('released twice');
    await store.close();
  });
});
