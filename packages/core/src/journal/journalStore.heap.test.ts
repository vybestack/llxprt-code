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
import { MIB, startGrowthProbe } from './__tests__/support/streamedBody.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

/** Pops and appends in the loop; the settled heap may rise this far above where it started. */
const GROWTH_BOUND = 4 * MIB;
const ITERATIONS = 10_000;
const SAMPLES = 4;
const RUN_MS = 170_000;
const BASE_ROWS = 8;

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
   * exercised 10,000 times. `retain` is called with each published version.
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
    const store = await JournalStore.create(
      path.join(directory(), name),
      storeDeps({ createCache }),
    );
    open.push(store);
    const model = new ArrayModel();
    await appendEach(
      store,
      Array.from({ length: BASE_ROWS }, () => draftRow()),
    );
    model.append(BASE_ROWS);
    const probe = await startGrowthProbe();
    const every = ITERATIONS / SAMPLES;
    for (let iteration = 1; iteration <= ITERATIONS; iteration++) {
      const [label] = model.append(1);
      await store.commit([
        {
          kind: 'append',
          rows: [
            draftRow({ calls: [`id-${iteration}`], text: `row ${iteration}` }),
          ],
        },
      ]);
      retain(current(store));
      const removed = model.popFrom(label);
      await store.commit([
        { kind: 'pop', cutLabel: label, expectedRemoved: removed },
      ]);
      retain(current(store));
      if (iteration % every === 0) await probe.sample();
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
