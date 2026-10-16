/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import { iterateRowEntries, type RowTreeRootRef } from './rowTreeReader.js';
import { cheapEntry } from './__tests__/support/cheapEntries.js';
import { NO_KINDS } from './__tests__/support/rowTreeFixtures.js';
import {
  createTreeWriter,
  openTree,
  type OpenedTree,
} from './__tests__/support/rowTreeHarness.js';
import {
  MIB,
  startGrowthProbe,
  type GrowthProbe,
} from './__tests__/support/streamedBody.js';

/**
 * The whole iteration, from the first row to the last, may leave the settled
 * heap this far above where it started. One root-to-leaf path is about 70 KiB
 * at depth 7; the rest is allocator and code-block noise.
 */
const ITERATION_GROWTH_BOUND = 4 * MIB;
/** The same for a build: one node under construction per level and one batch waiting for its write. */
const BUILD_GROWTH_BOUND = 8 * MIB;
const SIZES = [10_000, 100_000, 1_000_000] as const;
const SAMPLES_PER_RUN = 4;
/** A trap holds every entry (about 1.8 KiB each), so the largest size would need gigabytes. */
const TRAP_SIZES = [10_000, 100_000] as const;
const RUN_MS = 170_000;

interface BuiltTree {
  readonly opened: OpenedTree;
  readonly buildGrowth: number;
}

/** Entries made one at a time, sampling the heap along the way. */
async function* sampledEntries(
  count: number,
  probe: GrowthProbe,
): AsyncGenerator<RowEntry> {
  const every = Math.floor(count / SAMPLES_PER_RUN);
  for (let index = 0; index < count; index++) {
    if (index > 0 && index % every === 0) await probe.sample();
    yield cheapEntry(index);
  }
}

async function buildTree(directory: string, count: number): Promise<BuiltTree> {
  const file = path.join(directory, `rows-${count}.llxj`);
  const writer = await createTreeWriter(file, NO_KINDS);
  const probe = await startGrowthProbe();
  await writer.bulkBuild(sampledEntries(count, probe));
  await probe.sample();
  await writer.close();
  return { opened: await openTree(file), buildGrowth: probe.peakGrowth() };
}

/** The reference: one root-to-leaf path at a time. */
function pathIterator(access: RecordAccess, root: RowTreeRootRef) {
  return iterateRowEntries(access, root);
}

/** The trap: reads every entry into an array first and then hands them out. */
async function* collectingIterator(
  access: RecordAccess,
  root: RowTreeRootRef,
): AsyncGenerator<RowEntry> {
  const everything: RowEntry[] = [];
  for await (const entry of iterateRowEntries(access, root)) {
    everything.push(entry);
  }
  yield* everything;
}

interface Iteration {
  readonly rows: number;
  readonly growth: number;
}

/** Visits every row, checks the order, and samples the settled heap at fixed points on the way. */
async function measureIteration(
  entries: AsyncIterable<RowEntry>,
  count: number,
): Promise<Iteration> {
  const probe = await startGrowthProbe();
  const every = Math.floor(count / SAMPLES_PER_RUN);
  let rows = 0;
  for await (const entry of entries) {
    rows += 1;
    if (entry.label !== BigInt(rows) * 1000n) {
      throw new Error(`row ${rows} came out with label ${entry.label}`);
    }
    if (rows % every === 0) await probe.sample();
  }
  await probe.sample();
  return { rows, growth: probe.peakGrowth() };
}

describe('iterator heap', () => {
  let directory: string;
  const built = new Map<number, BuiltTree>();
  const pathGrowth = new Map<number, number>();

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'row-tree-heap-'));
    for (const count of SIZES)
      built.set(count, await buildTree(directory, count));
  }, RUN_MS);

  afterAll(async () => {
    for (const { opened } of built.values()) await opened.reader.close();
    await fs.rm(directory, { recursive: true, force: true });
  });

  function tree(count: number): { access: RecordAccess; root: RowTreeRootRef } {
    const entry = built.get(count);
    if (entry?.opened.root === undefined) throw new Error('tree not built');
    return { access: entry.opened.reader, root: entry.opened.root };
  }

  for (const count of SIZES) {
    it(`builds ${count} rows holding only one node per level`, () => {
      const growth = built.get(count)?.buildGrowth ?? Number.NaN;

      expect(growth).toBeLessThan(BUILD_GROWTH_BOUND);
    });
  }

  for (const count of SIZES) {
    it(
      `iterates all ${count} rows with the settled heap flat`,
      async () => {
        const { access, root } = tree(count);

        const { rows, growth } = await measureIteration(
          pathIterator(access, root),
          count,
        );

        pathGrowth.set(count, growth);
        expect(rows).toBe(count);
        expect(growth).toBeLessThan(ITERATION_GROWTH_BOUND);
      },
      RUN_MS,
    );
  }

  for (const count of TRAP_SIZES) {
    it(
      `control: an iterator that collects the entries first fails the same bound at ${count} rows`,
      async () => {
        const { access, root } = tree(count);

        const { rows, growth } = await measureIteration(
          collectingIterator(access, root),
          count,
        );

        expect(rows).toBe(count);
        expect(growth).toBeGreaterThan(ITERATION_GROWTH_BOUND);
      },
      RUN_MS,
    );
  }

  it('does not grow with the number of rows: the largest tree stays within a megabyte of the smallest', () => {
    const smallest = pathGrowth.get(SIZES[0]);
    const largest = pathGrowth.get(SIZES[SIZES.length - 1]);
    if (smallest === undefined || largest === undefined) {
      throw new Error('the iteration tests above did not record their growth');
    }

    expect(largest - smallest).toBeLessThan(MIB);
  });
});
