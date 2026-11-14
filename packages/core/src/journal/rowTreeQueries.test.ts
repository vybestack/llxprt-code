/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { entryByLabel } from './rowTreeQueries.js';
import { nextCuratedEntry } from './curatedQueries.js';
import { ROW_FLAG } from './rowRecord.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import {
  createTreeWriter,
  openTree,
} from './__tests__/support/rowTreeHarness.js';
import {
  NO_KINDS,
  syntheticEntry,
} from './__tests__/support/rowTreeFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

describe('label-keyed row tree reads', () => {
  const directory = useTempDir('row-tree-query-');

  it('finds exact and next curated rows without a second root descent', async () => {
    const counter = { reads: 0 };
    const dependencies = testJournalSeams(
      { readCounter: counter },
      1,
      false,
    ).dependencies;
    const random = new SeededRandom(1);
    const entries = Array.from({ length: 512 }, (_, index) => ({
      ...syntheticEntry(random, index, NO_KINDS),
      label: BigInt(index * 2 + 2),
      flags: index % 3 === 0 ? ROW_FLAG.curated : 0,
    }));
    const file = `${directory()}/queries.llxj`;
    const writer = await createTreeWriter(file, NO_KINDS, dependencies);
    await writer.bulkBuild(entries);
    await writer.close();
    const { reader, root } = await openTree(file, dependencies);
    try {
      if (root === undefined) throw new Error('Missing row tree');
      for (const index of [0, 99, 252, 510, 511]) {
        const entry = entries[index];
        counter.reads = 0;
        expect(await entryByLabel(reader, root, entry.label)).toStrictEqual(
          entry,
        );
        expect(counter.reads).toBeLessThanOrEqual(6);
        expect(
          await entryByLabel(reader, root, entry.label - 1n),
        ).toBeUndefined();
        const expected = entries.find(
          (candidate) =>
            candidate.label > entry.label &&
            (candidate.flags & ROW_FLAG.curated) !== 0,
        );
        counter.reads = 0;
        expect(
          await nextCuratedEntry(reader, root, 171, entry.label),
        ).toStrictEqual(expected);
        expect(counter.reads).toBeLessThanOrEqual(10);
      }
      expect(await entryByLabel(reader, undefined, 1n)).toBeUndefined();
      expect(await nextCuratedEntry(reader, root, 0, 0n)).toBeUndefined();
      expect(await nextCuratedEntry(reader, root, 171, 0n)).toStrictEqual(
        entries[0],
      );
    } finally {
      await reader.close();
    }
  });
});
