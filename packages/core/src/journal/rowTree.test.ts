/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import type { Aggregate } from './aggregate.js';
import {
  EMPTY_AGGREGATE,
  composeAggregates,
  type SlotKinds,
} from './aggregateComposition.js';
import { JournalFormatError } from './errors.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import { ROW_TREE_ARITY } from './rowTreeNode.js';
import {
  entryAt,
  iterateRowEntries,
  readRowTreeNode,
  type RowTreeRootRef,
} from './rowTreeReader.js';
import {
  createTreeWriter,
  openTree,
  reopenTreeWriter,
  type TreeFixtureWriter,
} from './__tests__/support/rowTreeHarness.js';
import {
  NO_KINDS,
  TEST_KINDS,
  naiveAggregate,
  syntheticEntry,
} from './__tests__/support/rowTreeFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const SIZES = [1, 7, 8, 9, 64, 65, 1000, 10000] as const;
/** The 10,000-row cases write and then verify every node of the tree. */
const HEAVY_TEST_MS = 60_000;

function entriesOf(count: number, kinds: SlotKinds, seed = count): RowEntry[] {
  const random = new SeededRandom(seed);
  return Array.from({ length: count }, (_, index) =>
    syntheticEntry(random, index, kinds),
  );
}

/** Levels of a tree that packs `count` rows: leaves hold 8 rows and every node above holds 8 children. */
function expectedLevels(count: number): number {
  let levels = 1;
  for (
    let capacity = ROW_TREE_ARITY;
    capacity < count;
    capacity *= ROW_TREE_ARITY
  ) {
    levels += 1;
  }
  return levels;
}

/** Group sizes for the incremental builds: single rows while that is cheap, then runs of seven. */
function chunkSize(count: number): number {
  return count <= 65 ? 1 : 7;
}

async function appendInChunks(
  writer: TreeFixtureWriter,
  entries: readonly RowEntry[],
  size: number,
): Promise<void> {
  for (let at = 0; at < entries.length; at += size) {
    await writer.appendRows(entries.slice(at, at + size));
  }
}

async function collectRows(
  access: RecordAccess,
  root: RowTreeRootRef,
  from = 0,
): Promise<RowEntry[]> {
  const rows: RowEntry[] = [];
  for await (const entry of iterateRowEntries(access, root, from)) {
    rows.push(entry);
  }
  return rows;
}

function sampleIndexes(count: number): number[] {
  if (count <= 1000) return Array.from({ length: count }, (_, index) => index);
  const picked = new Set([0, 1, count - 2, count - 1]);
  for (let index = 0; index < count; index += 97) picked.add(index);
  return [...picked];
}

interface Verified {
  readonly count: number;
  readonly level: number;
  readonly maxLabel: bigint;
  readonly aggregate: Aggregate;
}

/**
 * Walks a node and returns what it covers, worked out from its leaves alone.
 * Every internal slot must describe its child exactly: row count, largest
 * label and the aggregate of the child's own items.
 */
async function verifyNodes(
  access: RecordAccess,
  offset: number,
  kinds: SlotKinds,
  expectedLevel?: number,
): Promise<Verified> {
  const node = await readRowTreeNode(access, offset);
  if (node.kind === 'leaf') {
    expect(expectedLevel ?? 0).toBe(0);
    return {
      count: node.entries.length,
      level: 0,
      maxLabel: node.entries[node.entries.length - 1].label,
      aggregate: naiveAggregate(node.entries, kinds),
    };
  }
  expect(expectedLevel ?? node.level).toBe(node.level);
  let folded = EMPTY_AGGREGATE;
  let count = 0;
  for (const slot of node.slots) {
    const child = await verifyNodes(
      access,
      slot.childOffset,
      kinds,
      node.level - 1,
    );
    expect(slot.count).toBe(child.count);
    expect(slot.maxLabel).toBe(child.maxLabel);
    expect(slot.aggregate).toStrictEqual(child.aggregate);
    folded = composeAggregates(folded, child.aggregate, kinds);
    count += child.count;
  }
  return {
    count,
    level: node.level,
    maxLabel: node.slots[node.slots.length - 1].maxLabel,
    aggregate: folded,
  };
}

async function verifyTree(
  file: string,
  entries: readonly RowEntry[],
  kinds: SlotKinds,
): Promise<{ levels: number }> {
  const { reader, root } = await openTree(file);
  try {
    if (root === undefined) throw new Error('the tree has no root');
    expect(root.rows).toBe(entries.length);
    expect(reader.trailer?.rootAggregate).toStrictEqual(
      naiveAggregate(entries, kinds),
    );
    for (const index of sampleIndexes(entries.length)) {
      expect(await entryAt(reader, root, index)).toStrictEqual(entries[index]);
    }
    expect(await collectRows(reader, root)).toStrictEqual([...entries]);
    const middle = Math.floor(entries.length / 2);
    expect(await collectRows(reader, root, middle)).toStrictEqual(
      entries.slice(middle),
    );
    const shape = await verifyNodes(reader, root.offset, kinds);
    expect(shape.count).toBe(entries.length);
    return { levels: shape.level + 1 };
  } finally {
    await reader.close();
  }
}

describe('row tree built by appending groups', () => {
  const tempDir = useTempDir('row-tree-append-');

  for (const count of SIZES) {
    it(
      `holds ${count} rows after appending them in small groups: seek, aggregate and reopen agree with the rows`,
      async () => {
        const file = path.join(tempDir(), `append-${count}.llxj`);
        const entries = entriesOf(count, TEST_KINDS);
        const writer = await createTreeWriter(file, TEST_KINDS);

        await appendInChunks(writer, entries, chunkSize(count));
        await writer.close();

        const { levels } = await verifyTree(file, entries, TEST_KINDS);
        expect(levels).toBe(expectedLevels(count));
      },
      HEAVY_TEST_MS,
    );
  }

  for (const count of [1, 8, 9, 65, 1000]) {
    it(
      `holds ${count} rows appended as one group`,
      async () => {
        const file = path.join(tempDir(), `one-group-${count}.llxj`);
        const entries = entriesOf(count, TEST_KINDS);
        const writer = await createTreeWriter(file, TEST_KINDS);

        await writer.appendRows(entries);
        await writer.close();

        const { levels } = await verifyTree(file, entries, TEST_KINDS);
        expect(levels).toBe(expectedLevels(count));
      },
      HEAVY_TEST_MS,
    );
  }
});

describe('row tree built in bulk', () => {
  const tempDir = useTempDir('row-tree-bulk-');

  for (const count of SIZES) {
    it(
      `holds ${count} rows after one bottom-up build: seek, aggregate and reopen agree with the rows`,
      async () => {
        const file = path.join(tempDir(), `bulk-${count}.llxj`);
        const entries = entriesOf(count, TEST_KINDS);
        const writer = await createTreeWriter(file, TEST_KINDS);

        await writer.bulkBuild(entries);
        await writer.close();

        const { levels } = await verifyTree(file, entries, TEST_KINDS);
        expect(levels).toBe(expectedLevels(count));
      },
      HEAVY_TEST_MS,
    );
  }

  it('has depth 1 + ceil(log8(rows / 8)) as the design counts it', async () => {
    const expected: Array<readonly [number, number]> = [
      [1, 1],
      [8, 1],
      [9, 2],
      [64, 2],
      [65, 3],
      [1000, 4],
    ];
    const actual: Array<readonly [number, number]> = [];
    for (const [count] of expected) {
      const file = path.join(tempDir(), `depth-${count}.llxj`);
      const writer = await createTreeWriter(file, NO_KINDS);
      await writer.bulkBuild(entriesOf(count, NO_KINDS));
      await writer.close();

      const { reader, root } = await openTree(file);
      if (root === undefined) throw new Error('the tree has no root');
      const top = await readRowTreeNode(reader, root.offset);
      await reader.close();

      actual.push([count, top.kind === 'leaf' ? 1 : top.level + 1]);
    }

    expect(actual).toStrictEqual(expected);
  });

  it('refuses entries whose labels do not ascend', async () => {
    const file = path.join(tempDir(), 'unsorted.llxj');
    const writer = await createTreeWriter(file, NO_KINDS);
    const [first, second] = entriesOf(2, NO_KINDS);

    await expect(writer.bulkBuild([second, first])).rejects.toThrow(
      JournalFormatError,
    );
    await writer.close();
  });

  it('builds nothing for no entries', async () => {
    const file = path.join(tempDir(), 'none.llxj');
    const writer = await createTreeWriter(file, NO_KINDS);

    await writer.bulkBuild([]);
    await writer.close();

    const { reader, root } = await openTree(file);
    await reader.close();
    expect(root).toBeUndefined();
    expect(reader.trailer?.rowRoot).toBe(0);
  });
});

describe('bulk build and append build the same tree', () => {
  const tempDir = useTempDir('row-tree-same-');

  for (const count of [9, 65, 1000]) {
    it(`gives the same rows and root aggregate for ${count} rows`, async () => {
      const entries = entriesOf(count, TEST_KINDS);
      const bulkFile = path.join(tempDir(), 'bulk.llxj');
      const chunkFile = path.join(tempDir(), 'chunk.llxj');
      const bulk = await createTreeWriter(bulkFile, TEST_KINDS);
      await bulk.bulkBuild(entries);
      await bulk.close();
      const chunked = await createTreeWriter(chunkFile, TEST_KINDS);
      await appendInChunks(chunked, entries, 5);
      await chunked.close();

      const left = await openTree(bulkFile);
      const right = await openTree(chunkFile);
      const leftRows = left.root && (await collectRows(left.reader, left.root));
      const rightRows =
        right.root && (await collectRows(right.reader, right.root));
      expect(leftRows).toStrictEqual(rightRows);
      expect(left.reader.trailer?.rootAggregate).toStrictEqual(
        right.reader.trailer?.rootAggregate,
      );
      await left.reader.close();
      await right.reader.close();
    });
  }
});

describe('appending to a tree reopened from disk', () => {
  const tempDir = useTempDir('row-tree-reopen-');

  it(
    'rebuilds the right spine from the file and carries on exactly as if the writer had stayed open',
    async () => {
      const file = path.join(tempDir(), 'reopen.llxj');
      const entries = entriesOf(1000, TEST_KINDS);
      const first = await createTreeWriter(file, TEST_KINDS);
      await appendInChunks(first, entries.slice(0, 333), 11);
      await first.close();

      const reopened = await reopenTreeWriter(file, TEST_KINDS);
      await appendInChunks(reopened, entries.slice(333, 700), 13);
      await reopened.close();
      const again = await reopenTreeWriter(file, TEST_KINDS);
      await again.appendRows(entries.slice(700));
      await again.close();

      const { levels } = await verifyTree(file, entries, TEST_KINDS);
      expect(levels).toBe(expectedLevels(entries.length));
    },
    HEAVY_TEST_MS,
  );
});

describe('appending path-copies only the right spine', () => {
  const tempDir = useTempDir('row-tree-spine-');

  it('shares every node left of the right spine with the previous version', async () => {
    const file = path.join(tempDir(), 'share.llxj');
    const entries = entriesOf(200, NO_KINDS);
    const writer = await createTreeWriter(file, NO_KINDS);
    await writer.appendRows(entries.slice(0, 199));
    const before = writer.writer.published?.trailer.rowRoot;
    const lengthBefore = writer.writer.published?.durableEnd ?? 0;

    const ack = await writer.appendRows(entries.slice(199));
    await writer.close();

    // One leaf and one node per internal level: depth 3 here, so four nodes at most.
    const written = ack.durableEnd - lengthBefore;
    expect(before).toBeGreaterThan(0);
    expect(written).toBeLessThan(5 * 9384 + 1504);
    expect(written).toBeGreaterThan(ROW_TREE_ARITY);
  });
});

describe('seeking by index', () => {
  const tempDir = useTempDir('row-tree-seek-');

  it('refuses an index outside the tree', async () => {
    const file = path.join(tempDir(), 'range.llxj');
    const writer = await createTreeWriter(file, NO_KINDS);
    await writer.bulkBuild(entriesOf(20, NO_KINDS));
    await writer.close();
    const { reader, root } = await openTree(file);
    if (root === undefined) throw new Error('the tree has no root');

    await expect(entryAt(reader, root, -1)).rejects.toThrow(RangeError);
    await expect(entryAt(reader, root, 20)).rejects.toThrow(RangeError);
    await reader.close();
  });

  it('starts an iteration at the entry it was asked for and ends at the last row', async () => {
    const file = path.join(tempDir(), 'start.llxj');
    const entries = entriesOf(100, NO_KINDS);
    const writer = await createTreeWriter(file, NO_KINDS);
    await writer.bulkBuild(entries);
    await writer.close();
    const { reader, root } = await openTree(file);
    if (root === undefined) throw new Error('the tree has no root');

    for (const from of [0, 1, 7, 8, 9, 63, 64, 99]) {
      expect(await collectRows(reader, root, from)).toStrictEqual(
        entries.slice(from),
      );
    }
    expect(await collectRows(reader, root, 100)).toStrictEqual([]);
    await reader.close();
  });
});
