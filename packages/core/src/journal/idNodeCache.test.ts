/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  BoundedIdNodeCache,
  ID_NODE_CACHE_BYTES,
  ID_NODE_CACHE_ENTRY_OVERHEAD,
  type IdNodeCache,
} from './idTrieCache.js';
import { ID_HASH_BYTES, type IdEntry } from './idTrieNode.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import {
  IdTrieFixture,
  hex,
  sortedByHash,
} from './__tests__/support/idTrieHarness.js';
import { UnboundedIdNodeCache } from './__tests__/support/unboundedIdNodeCache.js';

const IDS = 30_000;
const LOOKUPS = 100_000;
const CHECK_EVERY = 1000;

function hashOf(id: string): Uint8Array {
  return Uint8Array.from(
    createHash('sha256').update(id, 'utf8').digest().subarray(0, ID_HASH_BYTES),
  );
}

function entryOf(index: number): IdEntry {
  const id = `cache-${index}`;
  return { hash: hashOf(id), value: new TextEncoder().encode(id) };
}

function withinCap(cache: IdNodeCache, cap: number): boolean {
  return cache.bytes <= cap;
}

describe('id node cache', () => {
  let directory: string;
  let fixture: IdTrieFixture;
  /** Every fact of the trie, by id index, so a lookup does not hash twice. */
  let facts: IdEntry[];

  beforeAll(async () => {
    directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'id-cache-'));
    fixture = await IdTrieFixture.create(path.join(directory, 'ids.llxj'));
    facts = Array.from({ length: IDS * 2 }, (_, index) => entryOf(index));
    await fixture.bulk(sortedByHash(facts.slice(0, IDS)));
  });

  afterAll(async () => {
    await fixture.close();
    await fsp.rm(directory, { recursive: true, force: true });
  });

  /** Looks up random present ids and reports the cache's size after every block. */
  async function run(cache: IdNodeCache): Promise<number[]> {
    const reader = fixture.reader(cache);
    const random = new SeededRandom(99);
    const sizes: number[] = [];
    for (let done = 0; done < LOOKUPS; done++) {
      const index = random.int(IDS);
      const found = await reader.lookup(fixture.root, facts[index].hash);
      if (found === undefined || hex(found) !== hex(facts[index].value)) {
        throw new Error(`lookup of ${index} returned the wrong fact`);
      }
      if (done % CHECK_EVERY === CHECK_EVERY - 1) sizes.push(cache.bytes);
    }
    return sizes;
  }

  it('states its cap and charges each node its bytes plus a fixed overhead', () => {
    expect(ID_NODE_CACHE_BYTES).toBe(64 * 1024);
    const cache = new BoundedIdNodeCache();
    cache.put(10, new Uint8Array(100));
    expect(cache.bytes).toBe(100 + ID_NODE_CACHE_ENTRY_OVERHEAD);
    expect(cache.entries).toBe(1);
    expect(cache.capBytes).toBe(ID_NODE_CACHE_BYTES);
  });

  it('evicts the least recently used node first', () => {
    const cache = new BoundedIdNodeCache(
      3 * (100 + ID_NODE_CACHE_ENTRY_OVERHEAD),
    );
    cache.put(1, new Uint8Array(100));
    cache.put(2, new Uint8Array(100));
    cache.put(3, new Uint8Array(100));
    expect(cache.get(1)).toBeDefined();
    cache.put(4, new Uint8Array(100));
    expect(cache.get(2)).toBeUndefined();
    expect(cache.get(1)).toBeDefined();
    expect(cache.get(3)).toBeDefined();
    expect(cache.get(4)).toBeDefined();
    expect(cache.entries).toBe(3);
  });

  it('stays at or below its cap across 100k lookups of a trie that is far larger', async () => {
    const cache = new BoundedIdNodeCache();
    const sizes = await run(cache);
    expect(sizes.length).toBe(LOOKUPS / CHECK_EVERY);
    expect(sizes.every((size) => size <= ID_NODE_CACHE_BYTES)).toBe(true);
    expect(Math.max(...sizes)).toBeGreaterThan(ID_NODE_CACHE_BYTES / 2);
    expect(withinCap(cache, ID_NODE_CACHE_BYTES)).toBe(true);
    const trieBytes = (await fsp.stat(fixture.file)).size;
    expect(trieBytes).toBeGreaterThan(10 * ID_NODE_CACHE_BYTES);
  });

  it('does not grow with the history: a trie twice the size caches the same bytes', async () => {
    const other = await IdTrieFixture.create(path.join(directory, 'ids2.llxj'));
    try {
      await other.bulk(sortedByHash(facts));
      const cache = new BoundedIdNodeCache();
      const reader = other.reader(cache);
      const random = new SeededRandom(7);
      for (let done = 0; done < 20_000; done++) {
        await reader.lookup(other.root, facts[random.int(IDS * 2)].hash);
      }
      expect(cache.bytes).toBeLessThanOrEqual(ID_NODE_CACHE_BYTES);
    } finally {
      await other.close();
    }
  });

  it('trap: a cache with no cap fails the cap check', async () => {
    const trap = new UnboundedIdNodeCache();
    await run(trap);
    expect(withinCap(trap, ID_NODE_CACHE_BYTES)).toBe(false);
    expect(trap.bytes).toBeGreaterThan(10 * ID_NODE_CACHE_BYTES);
  });
});
