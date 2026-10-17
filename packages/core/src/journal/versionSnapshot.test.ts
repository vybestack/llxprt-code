/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import type { RowEntry } from './rowEntry.js';

async function labels(entries: AsyncIterable<RowEntry>): Promise<bigint[]> {
  const out: bigint[] = [];
  for await (const entry of entries) out.push(entry.label);
  return out;
}

describe('version snapshot', () => {
  const directory = useTempDir('journal-snapshot-');

  it('is empty before the first group', async () => {
    const store = await JournalStore.create(
      path.join(directory(), 'empty.llxj'),
      storeDeps(),
    );
    const snapshot = await store.snapshot();
    expect(snapshot.rows).toBe(0);
    expect(await labels(snapshot.entries())).toStrictEqual([]);
    snapshot.close();
    await store.close();
  });

  it('keeps reading the version it was taken at while later groups commit', async () => {
    const store = await JournalStore.create(
      path.join(directory(), 'pinned.llxj'),
      storeDeps(),
    );
    await store.commit([
      { kind: 'append', rows: [draftRow(), draftRow(), draftRow()] },
    ]);
    const snapshot = await store.snapshot();
    const before = await labels(snapshot.entries());
    expect(before).toHaveLength(3);

    const first = await snapshot.entryAt(0);
    await store.commit([
      { kind: 'pop', cutLabel: before[1], expectedRemoved: 2 },
    ]);
    await store.commit([{ kind: 'append', rows: [draftRow()] }]);

    expect(snapshot.rows).toBe(3);
    expect(await labels(snapshot.entries())).toStrictEqual(before);
    expect((await snapshot.entryAt(2)).label).toBe(before[2]);
    expect((await snapshot.readRow(first)).header.label).toBe(before[0]);
    snapshot.close();
    const latest = await store.snapshot();
    expect(latest.rows).toBe(2);
    latest.close();
    await store.close();
  });
});
