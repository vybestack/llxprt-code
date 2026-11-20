/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { EMPTY_ID_FACT, decodeIdFact, encodeIdFact } from './idFactCodec.js';
import {
  BoundedIdNodeCache,
  ID_NODE_CACHE_BYTES,
  type IdNodeCache,
} from './idTrieCache.js';
import { ID_HASH_BYTES, type IdEntry } from './idTrieNode.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { IdTrieFixture } from './__tests__/support/idTrieHarness.js';
import {
  MIB,
  startGrowthProbe,
  type GrowthProbe,
} from './__tests__/support/streamedBody.js';
import { UnboundedIdNodeCache } from './__tests__/support/unboundedIdNodeCache.js';

/**
 * After a bulk build of the ids and a run of random lookups, the settled heap
 * may sit this far above where it started: the cache cap, and allocator and
 * code-block noise (the row tree tests allow 4 to 8 MiB for the same noise).
 */
const GROWTH_BOUND = ID_NODE_CACHE_BYTES + 2 * MIB;
/** The 1M trie may retain at most this much more than the 100k trie. */
const SIZE_SLACK = 1 * MIB;
const SIZES = [100_000, 1_000_000] as const;
const LOOKUPS = 20_000;
const SAMPLES_PER_RUN = 4;
const RUN_MS = 170_000;

const idOf = (index: number): string => `heap-id-${index}`;

function hashOf(index: number): Uint8Array {
  return Uint8Array.from(
    createHash('sha256')
      .update(idOf(index), 'utf8')
      .digest()
      .subarray(0, ID_HASH_BYTES),
  );
}

/** A fact with five positions, about the size of a real one. */
function valueOf(index: number): Uint8Array {
  const at = { label: BigInt(index + 1) * 1024n, part: 0, block: index % 7 };
  return encodeIdFact({
    ...EMPTY_ID_FACT,
    firstCall: at,
    firstAiCall: at,
    firstResponse: at,
    firstToolResponse: at,
    best: at,
    bestScore: 2,
    callCount: 1,
    respCount: 1,
  });
}

/** The index order of `count` ids sorted by hash, held as typed arrays of 12 bytes per id. */
function hashOrder(count: number): Uint32Array {
  const high = new Float64Array(count);
  const order = new Uint32Array(count);
  for (let index = 0; index < count; index++) {
    const hash = hashOf(index);
    high[index] =
      hash[0] * 2 ** 40 +
      hash[1] * 2 ** 32 +
      hash[2] * 2 ** 24 +
      hash[3] * 2 ** 16 +
      hash[4] * 2 ** 8 +
      hash[5];
    order[index] = index;
  }
  return order.sort((left, right) => {
    if (high[left] !== high[right]) return high[left] - high[right];
    return Buffer.compare(hashOf(left), hashOf(right));
  });
}

interface Run {
  readonly fixture: IdTrieFixture;
  readonly buildGrowth: number;
  readonly order: Uint32Array;
}

async function* sortedFacts(
  order: Uint32Array,
  probe: GrowthProbe,
): AsyncGenerator<IdEntry> {
  const every = Math.floor(order.length / SAMPLES_PER_RUN);
  for (let at = 0; at < order.length; at++) {
    if (at > 0 && at % every === 0) await probe.sample();
    const index = order[at];
    yield { hash: hashOf(index), value: valueOf(index) };
  }
}

describe('id trie heap', () => {
  let directory: string;
  const runs = new Map<number, Run>();
  const lookupGrowth = new Map<number, number>();

  beforeAll(async () => {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'id-trie-heap-'));
    for (const count of SIZES) {
      const order = hashOrder(count);
      const fixture = await IdTrieFixture.create(
        path.join(directory, `ids-${count}.llxj`),
      );
      const probe = await startGrowthProbe();
      await fixture.bulk(sortedFacts(order, probe));
      await probe.sample();
      runs.set(count, { fixture, buildGrowth: probe.peakGrowth(), order });
    }
  }, RUN_MS);

  afterAll(async () => {
    for (const { fixture } of runs.values()) await fixture.close();
    await fsp.rm(directory, { recursive: true, force: true });
  });

  function run(count: number): Run {
    const found = runs.get(count);
    if (found === undefined) throw new Error(`no run for ${count}`);
    return found;
  }

  /** Looks up random ids, checking each fact, and samples the settled heap on the way. */
  async function lookups(count: number, cache: IdNodeCache): Promise<number> {
    const { fixture } = run(count);
    const reader = fixture.reader(cache);
    const random = new SeededRandom(31);
    const probe = await startGrowthProbe();
    const every = Math.floor(LOOKUPS / SAMPLES_PER_RUN);
    for (let done = 1; done <= LOOKUPS; done++) {
      const index = random.int(count);
      const found = await reader.lookup(fixture.root, hashOf(index));
      if (found === undefined) throw new Error(`id ${index} is missing`);
      if (decodeIdFact(found).firstCall?.label !== BigInt(index + 1) * 1024n) {
        throw new Error(`id ${index} has another id's fact`);
      }
      if (done % every === 0) await probe.sample();
    }
    return probe.peakGrowth();
  }

  it('builds from a sorted stream with the heap flat, whatever the count', () => {
    for (const count of SIZES) {
      expect(run(count).buildGrowth).toBeLessThan(8 * MIB);
    }
  });

  it('holds every id after the build: the first, the last and a sample read back', async () => {
    for (const count of SIZES) {
      const { fixture, order } = run(count);
      const reader = fixture.reader();
      for (const at of [0, 1, Math.floor(count / 2), count - 2, count - 1]) {
        const index = order[at];
        const found = await reader.lookup(fixture.root, hashOf(index));
        expect(found && decodeIdFact(found).firstCall?.label).toBe(
          BigInt(index + 1) * 1024n,
        );
      }
      expect(
        await reader.lookup(fixture.root, hashOf(count + 5)),
      ).toBeUndefined();
    }
  });

  it(
    'settles flat after lookups: growth is at most the cache cap plus noise, and does not scale with the ids',
    async () => {
      for (const count of SIZES) {
        const cache = new BoundedIdNodeCache();
        lookupGrowth.set(count, await lookups(count, cache));
        expect(cache.bytes).toBeLessThanOrEqual(ID_NODE_CACHE_BYTES);
        expect(lookupGrowth.get(count) ?? Infinity).toBeLessThan(GROWTH_BOUND);
      }
      const small = lookupGrowth.get(SIZES[0]) ?? 0;
      const large = lookupGrowth.get(SIZES[1]) ?? Infinity;
      expect(large - small).toBeLessThan(SIZE_SLACK);
    },
    RUN_MS,
  );

  it(
    'trap: a cache that keeps every node it reads fails the same bound',
    async () => {
      const trap = new UnboundedIdNodeCache();
      const growth = await lookups(SIZES[1], trap);
      expect(growth).toBeGreaterThan(GROWTH_BOUND);
      expect(trap.bytes).toBeGreaterThan(ID_NODE_CACHE_BYTES);
    },
    RUN_MS,
  );
});
