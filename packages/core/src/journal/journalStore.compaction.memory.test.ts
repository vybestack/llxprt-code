import { testNamedWriters } from './__tests__/support/namedWriterOwner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { median } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import {
  ageOutIdleCode,
  applicationHeapBytes,
  FLATNESS_BOUND_BYTES,
  medianSettledHeap,
  PerVersionBuilders,
  RETAINED_BOUND_BYTES,
  sessionWithCheckpoints,
} from './__tests__/support/compactionMemory.js';
import { DEFAULT_BATCH_BYTES } from './groupAppender.js';
import { ID_TRIE_MAX_DEPTH, ID_TRIE_PREFETCH_BYTES } from './idTrieNode.js';
import { ROW_TREE_ARITY, ROW_TREE_MAX_FRAME_BYTES } from './rowTreeNode.js';
import { iterateRowEntries } from './rowTreeReader.js';
import { JournalStore } from './journalStore.js';
import { storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const COUNTS = [1, 10, 100, 1000] as const;
/** As large as the middle case, so the one-time costs of a hot copy are in every baseline. */
const WARMUP = 100;
const LONG_TEST_MS = 900_000;

describe('store compaction memory with growing checkpoint counts (design 13.6)', () => {
  const directory = useTempDir('journal-store-compaction-memory-');
  const open: JournalStore[] = [];

  afterEach(async () => {
    await Promise.all(open.splice(0).map((store) => store.close()));
  });

  async function build(checkpoints: number, name: string) {
    const file = path.join(directory(), `${name}.llxj`);
    const built = await sessionWithCheckpoints(file, checkpoints);
    await built.close();
    // A swap discards writer caches. Start with empty caches too, so their
    // checkpoint-dependent construction cost cannot mask retained copy memory.
    const store = await JournalStore.open(
      file,
      storeDeps({ seams: testJournalSeams({}, 1, false) }),
      testNamedWriters,
    );
    open.push(store);
    return store;
  }

  async function settledApplicationBytes(label: string): Promise<number> {
    const readings: number[] = [];
    for (let reading = 0; reading < 3; reading++) {
      await medianSettledHeap(label);
      readings.push(applicationHeapBytes());
    }
    return median(readings);
  }

  /** One serial version walk, one pending batch and the largest fixture row. */
  async function oneVersionAllowance(store: JournalStore): Promise<number> {
    const read = await store.openRead();
    try {
      const version = read.version;
      if (version === undefined) throw new Error('missing published version');
      let largestRow = 0;
      for await (const entry of iterateRowEntries(read.access, {
        offset: version.roots.rowRoot,
        rows: version.rows,
      }))
        largestRow = Math.max(largestRow, entry.recordLength);
      const rowDepth = Math.max(
        1,
        Math.ceil(Math.log(version.rows) / Math.log(ROW_TREE_ARITY)),
      );
      const allowance =
        DEFAULT_BATCH_BYTES +
        rowDepth * ROW_TREE_MAX_FRAME_BYTES +
        ID_TRIE_MAX_DEPTH * ID_TRIE_PREFETCH_BYTES +
        largestRow;
      expect(allowance).toBeLessThanOrEqual(RETAINED_BOUND_BYTES);
      return allowance;
    } finally {
      await read.close();
    }
  }

  /** Application growth preserves negative deltas without engine-code aging offsets. */
  async function growthOf(work: () => Promise<void>): Promise<number> {
    const before = await settledApplicationBytes('before the compaction');
    await work();
    return (await settledApplicationBytes('after the compaction')) - before;
  }

  it(
    'retains nothing that grows with the checkpoints: the heap after the swap is flat from 1 to 1,000 checkpoints',
    async () => {
      const warm = await build(WARMUP, 'warm');
      const stores = new Map<number, JournalStore>();
      for (const count of COUNTS)
        stores.set(count, await build(count, `n${count}`));
      const largest = stores.get(COUNTS[COUNTS.length - 1]);
      if (largest === undefined) throw new Error('missing largest store');
      const allowance = await oneVersionAllowance(largest);
      await ageOutIdleCode();
      expect(await warm.compact()).toBe('swapped');

      const growth: number[] = [];
      for (const count of COUNTS) {
        const store = stores.get(count);
        if (store === undefined) throw new Error('missing store');
        growth.push(
          await growthOf(async () => {
            expect(await store.compact()).toBe('swapped');
          }),
        );
        expect(store.published?.rows).toBeGreaterThan(count);
      }

      process.stdout
        .write(`STORE_COMPACTION_MEMORY ${JSON.stringify({ counts: COUNTS, allowance, growth })}
`);
      for (const retained of growth) expect(retained).toBeLessThan(allowance);
      expect(Math.max(...growth) - Math.min(...growth)).toBeLessThan(
        FLATNESS_BOUND_BYTES,
      );
      for (const retained of growth.slice(1))
        expect(retained - growth[0]).toBeLessThan(FLATNESS_BOUND_BYTES);
    },
    LONG_TEST_MS,
  );

  it(
    'a compaction that keeps the state of every checkpoint version in memory exceeds the bounds',
    async () => {
      const warm = await build(WARMUP, 'trap-warm');
      const small = await build(1, 'trap-small');
      const large = await build(WARMUP, 'trap-large');
      const traps = [
        new PerVersionBuilders(small),
        new PerVersionBuilders(large),
      ];
      const allowance = await oneVersionAllowance(large);
      await ageOutIdleCode();
      expect(await warm.compact()).toBe('swapped');

      const growth: number[] = [];
      for (const [index, store] of [small, large].entries()) {
        const trap = traps[index];
        growth.push(
          await growthOf(async () => {
            for await (const checkpoint of store.checkpoints()) {
              await trap.collect({
                sourceOffset: checkpoint.descriptor.trailerOffset,
                offset: 0,
                commitSeq: checkpoint.descriptor.commitSeq,
              });
            }
            expect(await store.compact()).toBe('swapped');
          }),
        );
      }

      expect(traps.map((trap) => trap.held)).toStrictEqual([1, WARMUP]);
      process.stdout
        .write(`STORE_COMPACTION_CONTROL ${JSON.stringify({ counts: [1, WARMUP], allowance, growth })}
`);
      expect(growth[1]).toBeGreaterThanOrEqual(3 * allowance);
      expect(growth[1] - growth[0]).toBeGreaterThan(FLATNESS_BOUND_BYTES);
    },
    LONG_TEST_MS,
  );
});
