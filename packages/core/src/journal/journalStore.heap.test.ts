/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';
import { JournalStore } from './journalStore.js';
import type { Version } from './version.js';
import {
  ArrayModel,
  appendEach,
  draftRow,
  labelsOf,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { ageOutIdleCode } from './__tests__/support/compactionMemory.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { MIB, startGrowthProbe } from './__tests__/support/streamedBody.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

/** Pops and appends in the loop; the settled heap may rise this far above where it started. */
const GROWTH_BOUND = 4 * MIB;
const ITERATIONS = 10_000;
const SAMPLES = 4;
const RUN_MS = 170_000;
const BASE_ROWS = 8;
/**
 * Iterations before the baseline. They compile the commit path, which costs
 * a few MiB of code blocks once and does not grow with the count (measured:
 * the same settled growth at 1,000, 10,000 and 20,000 iterations).
 */
const WARMUP_ITERATIONS = 1_000;

function current(store: JournalStore): Version {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

interface LoopResult {
  readonly growth: number;
  readonly caches: readonly BoundedIdNodeCache[];
  readonly store: JournalStore;
  readonly model: ArrayModel;
}

describe('journal store heap', () => {
  const directory = useTempDir('journal-heap-');
  const open: JournalStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.close();
  });

  /**
   * Each iteration appends a row with an id of its own and pops it again, so
   * the history stays at `BASE_ROWS` while every kind of per-commit state is
   * exercised 10,000 times. `retain` is called with each published version
   * of the measured iterations.
   *
   * The baseline is taken after a warm-up and after the idle start-up code
   * is dropped: both are one-time costs of the process and not growth of the
   * store. The seams drop their event log, which has an entry per file
   * operation and would be counted as growth of the store.
   */
  async function loop(
    name: string,
    retain: (version: Version) => void,
  ): Promise<LoopResult> {
    const caches: BoundedIdNodeCache[] = [];
    const createCache = (): IdNodeCache => {
      const cache = new BoundedIdNodeCache();
      caches.push(cache);
      return cache;
    };
    const seams = testJournalSeams({}, 1, false);
    const store = await JournalStore.create(
      path.join(directory(), name),
      storeDeps({ createCache, seams }),
    );
    open.push(store);
    const model = new ArrayModel();
    await appendEach(
      store,
      Array.from({ length: BASE_ROWS }, () => draftRow()),
    );
    model.append(BASE_ROWS);
    const iterate = async (iteration: number, keep: boolean): Promise<void> => {
      const [label] = model.append(1);
      await store.commit([
        {
          kind: 'append',
          rows: [
            draftRow({ calls: [`id-${iteration}`], text: `row ${iteration}` }),
          ],
        },
      ]);
      if (keep) retain(current(store));
      const removed = model.popFrom(label);
      await store.commit([
        { kind: 'pop', cutLabel: label, expectedRemoved: removed },
      ]);
      if (keep) retain(current(store));
    };
    for (let iteration = 1; iteration <= WARMUP_ITERATIONS; iteration++) {
      await iterate(iteration, false);
    }
    await ageOutIdleCode();
    const probe = await startGrowthProbe();
    const every = ITERATIONS / SAMPLES;
    for (let count = 1; count <= ITERATIONS; count++) {
      await iterate(WARMUP_ITERATIONS + count, true);
      if (count % every === 0) await probe.sample();
    }
    return { growth: probe.peakGrowth(), caches, store, model };
  }

  it(
    'keeps the settled heap flat over 10,000 appends and pops, with every cache under its cap',
    async () => {
      const result = await loop('flat.llxj', () => undefined);
      expect(result.growth).toBeLessThan(GROWTH_BOUND);
      for (const cache of result.caches) {
        expect(cache.bytes).toBeLessThanOrEqual(cache.capBytes);
      }
      expect(await labelsOf(result.store)).toStrictEqual([
        ...result.model.liveLabels,
      ]);
      expect(result.store.published?.rows).toBe(BASE_ROWS);
    },
    RUN_MS,
  );

  it(
    'trap: a store that keeps every version it publishes fails the same bound',
    async () => {
      const kept: Version[] = [];
      const result = await loop('trap.llxj', (version) => {
        kept.push(version);
      });
      expect(kept).toHaveLength(2 * ITERATIONS);
      expect(result.growth).toBeGreaterThan(GROWTH_BOUND);
    },
    RUN_MS,
  );
});
