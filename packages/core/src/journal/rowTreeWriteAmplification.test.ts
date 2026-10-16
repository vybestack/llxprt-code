/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { GroupRecord } from './groupWriter.js';
import { RECORD_KIND } from './recordKinds.js';
import { frameLength } from './frame.js';
import { CHILD_SLOT_BYTES, ROW_TREE_ARITY } from './rowTreeNode.js';
import { TRAILER_RECORD_BYTES } from './trailerRecord.js';
import { cheapEntries, cheapEntry } from './__tests__/support/cheapEntries.js';
import { NO_KINDS } from './__tests__/support/rowTreeFixtures.js';
import {
  createTreeWriter,
  type TreeFixtureWriter,
} from './__tests__/support/rowTreeHarness.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const KIB = 1024;
/** Design 13.6: a group with one appended row and one id writes at most this much at 100k rows. */
const ONE_ROW_BUDGET_AT_100K = 72 * KIB;
/** One path-copied internal node, from design 3.2 (8 slots of 1,168 bytes and a header). */
const INTERNAL_NODE_BYTES = 9384;
/** The row tree depth the budget is written for: a leaf and five internal levels at 100k rows. */
const INTERNAL_LEVELS_AT_100K = 5;
/**
 * 4,095 and 32,767 rows are one short of 8^4 and 8^5, so every node on the
 * right spine is full once the row is added: the largest path copy there is.
 */
const SIZES = [1_000, 4_095, 10_000, 32_767, 100_000] as const;
/** Rows the full-rebuild control rewrites; at 100k rows it would write more than 100 MB. */
const CONTROL_SIZES = [1_000, 10_000] as const;
const RUN_MS = 120_000;

/** The row and the trie nodes for one id that a real append writes besides the tree (design 3.2). */
function standInRecords(): GroupRecord[] {
  const row: GroupRecord = {
    kind: RECORD_KIND.ROW,
    kindHeader: new Uint8Array(8),
    body: { length: 1000, chunks: [new Uint8Array(1000)] },
  };
  const idNodes = Array.from(
    { length: 6 },
    (): GroupRecord => ({
      kind: RECORD_KIND.ITNODE,
      kindHeader: new Uint8Array(8),
      body: { length: 1000, chunks: [new Uint8Array(1000)] },
    }),
  );
  return [row, ...idNodes];
}

/** Internal levels above the leaves of a tree that packs `rows` rows. */
function internalLevels(rows: number): number {
  let levels = 0;
  for (
    let capacity = ROW_TREE_ARITY;
    capacity < rows;
    capacity *= ROW_TREE_ARITY
  ) {
    levels += 1;
  }
  return levels;
}

/** The 100k limit less the path copies a shallower tree does not make. */
function oneRowBudget(rows: number): number {
  const missing = INTERNAL_LEVELS_AT_100K - internalLevels(rows + 1);
  return ONE_ROW_BUDGET_AT_100K - missing * INTERNAL_NODE_BYTES;
}

function recordsBytes(records: readonly GroupRecord[]): number {
  return records.reduce(
    (sum, record) =>
      sum + frameLength(record.kindHeader.length, record.body?.length ?? 0),
    0,
  );
}

async function sizeOf(file: string): Promise<number> {
  return (await fs.stat(file)).size;
}

/** Bytes the file grew by while `commit` ran. */
async function bytesWritten(
  file: string,
  commit: () => Promise<unknown>,
): Promise<number> {
  const before = await sizeOf(file);
  await commit();
  return (await sizeOf(file)) - before;
}

async function baseTree(
  file: string,
  rows: number,
): Promise<TreeFixtureWriter> {
  const writer = await createTreeWriter(file, NO_KINDS);
  await writer.bulkBuild(cheapEntries(rows));
  return writer;
}

describe('write amplification of one appended row', () => {
  const tempDir = useTempDir('row-tree-amp-');

  for (const rows of SIZES) {
    it(
      `writes within the budget when one row and its id are appended to ${rows} rows`,
      async () => {
        const file = path.join(tempDir(), `append-${rows}.llxj`);
        const writer = await baseTree(file, rows);

        const written = await bytesWritten(file, () =>
          writer.appendRows([cheapEntry(rows)], standInRecords()),
        );
        await writer.close();

        // The group cannot be smaller than its stand-in records, its trailer and
        // one slot for every internal node of the copied path.
        expect(written).toBeGreaterThan(
          recordsBytes(standInRecords()) +
            TRAILER_RECORD_BYTES +
            internalLevels(rows + 1) * CHILD_SLOT_BYTES,
        );
        expect(written).toBeLessThanOrEqual(oneRowBudget(rows));
      },
      RUN_MS,
    );
  }

  for (const rows of CONTROL_SIZES) {
    it(
      `control: rebuilding the whole tree to append one row to ${rows} rows exceeds the budget`,
      async () => {
        const file = path.join(tempDir(), `rebuild-${rows}.llxj`);
        const writer = await baseTree(file, rows);

        const written = await bytesWritten(file, () =>
          writer.bulkBuild(cheapEntries(rows + 1)),
        );
        await writer.close();

        expect(written).toBeGreaterThan(oneRowBudget(rows));
      },
      RUN_MS,
    );
  }
});
