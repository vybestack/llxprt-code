/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import type { SlotKinds } from './aggregateComposition.js';
import type { RowEntry } from './rowEntry.js';
import { splitSizes } from './rowTreeEdit.js';
import { ROW_TREE_ARITY } from './rowTreeNode.js';
import {
  createTreeWriter,
  openTree,
  type TreeFixtureWriter,
} from './__tests__/support/rowTreeHarness.js';
import {
  NO_KINDS,
  TEST_KINDS,
  naiveAggregate,
  syntheticEntry,
} from './__tests__/support/rowTreeFixtures.js';
import { collectRows, verifyNodes } from './__tests__/support/rowTreeVerify.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

/** Labels of `syntheticEntry` are `(index + 1) * 1000`, so labels between them are free. */
function baseEntries(count: number, kinds: SlotKinds): RowEntry[] {
  const random = new SeededRandom(count + 17);
  return Array.from({ length: count }, (_, index) =>
    syntheticEntry(random, index, kinds),
  );
}

function sortedByLabel(entries: readonly RowEntry[]): RowEntry[] {
  return [...entries].sort((left, right) =>
    left.label < right.label ? -1 : 1,
  );
}

/** The entry at `source`'s place with other contents: the stand-in for an owner change or a fill. */
function changed(source: RowEntry, random: SeededRandom): RowEntry {
  return {
    ...source,
    owner: source.owner + 1 + random.int(5),
    tokens: [
      [random.int(500), 0, 0, 0],
      [0, random.int(500), 0, 0],
      [0, 0, random.int(500), 0],
    ],
  };
}

/** A new entry whose label lies strictly between two live labels, or after the last. */
function addedAfter(
  source: RowEntry,
  offset: bigint,
  random: SeededRandom,
  kinds: SlotKinds,
): RowEntry {
  return {
    ...syntheticEntry(random, 0, kinds),
    label: source.label + offset,
  };
}

async function build(
  file: string,
  entries: readonly RowEntry[],
  kinds: SlotKinds,
): Promise<TreeFixtureWriter> {
  const writer = await createTreeWriter(file, kinds);
  await writer.bulkBuild(entries);
  return writer;
}

async function expectTreeEquals(
  file: string,
  expected: readonly RowEntry[],
  kinds: SlotKinds,
): Promise<number> {
  const { reader, root } = await openTree(file);
  try {
    if (root === undefined) throw new Error('the tree has no root');
    expect(root.rows).toBe(expected.length);
    expect(await collectRows(reader, root)).toStrictEqual([...expected]);
    expect(reader.trailer?.rootAggregate).toStrictEqual(
      naiveAggregate(expected, kinds),
    );
    const shape = await verifyNodes(reader, root.offset, kinds);
    expect(shape.count).toBe(expected.length);
    return shape.level + 1;
  } finally {
    await reader.close();
  }
}

describe('splitSizes', () => {
  it('leaves a node that fits alone, cuts the rightmost node from the left and any other evenly', () => {
    expect(splitSizes(5, false)).toStrictEqual([5]);
    expect(splitSizes(8, true)).toStrictEqual([8]);
    expect(splitSizes(9, true)).toStrictEqual([8, 1]);
    expect(splitSizes(17, true)).toStrictEqual([8, 8, 1]);
    expect(splitSizes(9, false)).toStrictEqual([5, 4]);
    expect(splitSizes(20, false)).toStrictEqual([7, 7, 6]);
    for (const total of [9, 10, 31, 64, 65]) {
      for (const rightmost of [true, false]) {
        const sizes = splitSizes(total, rightmost);
        expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(total);
        expect(Math.max(...sizes)).toBeLessThanOrEqual(ROW_TREE_ARITY);
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

/** Replacements of about one entry in twenty, inserts after about one in twenty, and a few inserts after the last entry. */
function randomEdits(
  model: readonly RowEntry[],
  random: SeededRandom,
  kinds: SlotKinds,
  round: number,
): { replace: RowEntry[]; insert: RowEntry[] } {
  const replace: RowEntry[] = [];
  const insert: RowEntry[] = [];
  const taken = new Set<bigint>();
  for (const source of model) {
    const roll = random.int(20);
    if (roll === 0) replace.push(changed(source, random));
    if (roll !== 1) continue;
    const added = addedAfter(
      source,
      BigInt(1 + random.int(900)),
      random,
      kinds,
    );
    if (!taken.has(added.label)) insert.push(added);
    taken.add(added.label);
  }
  const last = model[model.length - 1];
  for (let tail = random.int(12); tail > 0; tail--) {
    const offset = BigInt(100_000 + round * 1000 + tail);
    insert.push(addedAfter(last, offset, random, kinds));
  }
  return { replace, insert };
}

describe('editing a row tree by path copying', () => {
  const tempDir = useTempDir('row-tree-edit-');

  for (const count of [1, 8, 9, 63, 64, 65, 500]) {
    it(`gives the entries and aggregate of a recomputation after random replacements and inserts into ${count} rows`, async () => {
      const kinds = count % 2 === 0 ? TEST_KINDS : NO_KINDS;
      const file = path.join(tempDir(), `edit-${count}.llxj`);
      const random = new SeededRandom(count);
      let model = baseEntries(count, kinds);
      const writer = await build(file, model, kinds);
      let edited = 0;

      for (let round = 0; round < 12; round++) {
        const { replace, insert } = randomEdits(model, random, kinds, round);
        if (replace.length + insert.length === 0) continue;
        const replaced = new Map(replace.map((entry) => [entry.label, entry]));
        model = sortedByLabel([
          ...model.map((entry) => replaced.get(entry.label) ?? entry),
          ...insert,
        ]);
        await writer.editRows({ replace, insert });
        expect(await expectTreeEquals(file, model, kinds)).toBeGreaterThan(0);
        edited += 1;
      }
      await writer.close();
      expect(edited).toBeGreaterThan(0);
    }, 60_000);
  }

  it('grows a new root when a full two-level tree takes one more entry, and keeps the old version readable', async () => {
    const file = path.join(tempDir(), 'grow.llxj');
    const random = new SeededRandom(5);
    const rows = baseEntries(64, NO_KINDS);
    const writer = await build(file, rows, NO_KINDS);
    const before = writer.writer.published;
    expect(await expectTreeEquals(file, rows, NO_KINDS)).toBe(2);

    const extra = addedAfter(rows[10], 7n, random, NO_KINDS);
    await writer.editRows({ replace: [], insert: [extra] });
    const model = sortedByLabel([...rows, extra]);
    expect(await expectTreeEquals(file, model, NO_KINDS)).toBe(3);

    // Nodes are immutable: the root the first group named still reads the 64 rows.
    const { reader } = await openTree(file);
    try {
      const old = before?.trailer.rowRoot;
      if (old === undefined) throw new Error('no earlier tree');
      expect(
        (await collectRows(reader, { offset: old, rows: 64 })).map(
          (entry) => entry.label,
        ),
      ).toStrictEqual(rows.map((entry) => entry.label));
    } finally {
      await reader.close();
    }
    await writer.close();
  });

  it('writes one path for one replaced entry: a few nodes at 10,000 rows, not the tree', async () => {
    const file = path.join(tempDir(), 'path.llxj');
    const random = new SeededRandom(9);
    const rows = baseEntries(10_000, NO_KINDS);
    const writer = await build(file, rows, NO_KINDS);
    const before = writer.writer.published?.durableEnd ?? 0;
    await writer.editRows({
      replace: [changed(rows[4321], random)],
      insert: [],
    });
    const written = (writer.writer.published?.durableEnd ?? 0) - before;
    // Five levels at 10,000 rows: one leaf, four internal nodes (not all full) and the trailer.
    const full = 8_872 + 4 * 9_384 + 1_504;
    expect(written).toBeLessThanOrEqual(full);
    expect(written).toBeGreaterThan(8_872 + 1_504);
    await writer.close();
  });

  it('refuses to replace a label that is not live, to insert one that is, and two edits of one label', async () => {
    const file = path.join(tempDir(), 'refuse.llxj');
    const random = new SeededRandom(3);
    const rows = baseEntries(20, NO_KINDS);
    const writer = await build(file, rows, NO_KINDS);
    const ghost = addedAfter(rows[3], 5n, random, NO_KINDS);

    await expect(
      writer.editRows({ replace: [ghost], insert: [] }),
    ).rejects.toThrow(/is not live/);
    await expect(
      writer.editRows({ replace: [], insert: [changed(rows[3], random)] }),
    ).rejects.toThrow(/already live/);
    await expect(
      writer.editRows({
        replace: [changed(rows[3], random)],
        insert: [changed(rows[3], random)],
      }),
    ).rejects.toThrow(/Two edits name label/);
    await expect(writer.editRows({ replace: [], insert: [] })).rejects.toThrow(
      /needs at least one change/,
    );
    await writer.close();
  });
});
