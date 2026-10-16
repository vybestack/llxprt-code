/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import {
  ID_HASH_BYTES,
  ID_TRIE_LEAF_CAPACITY,
  type IdEntry,
} from './idTrieNode.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import {
  IdTrieFixture,
  collectEntries,
  hex,
  reopenIdTrie,
  shapeSignature,
  sortedByHash,
  trieDepth,
} from './__tests__/support/idTrieHarness.js';

type Hasher = (id: string) => Uint8Array;

const sha256Hash: Hasher = (id) =>
  Uint8Array.from(
    createHash('sha256').update(id, 'utf8').digest().subarray(0, ID_HASH_BYTES),
  );

/**
 * Keys that share their first 20 nibbles, so every one of them splits
 * through a chain of single-child internal nodes before the keys part.
 */
const sharedPrefixHash: Hasher = (id) => {
  const hash = sha256Hash(id);
  hash.fill(0xab, 0, 10);
  return hash;
};

/** Keys that differ only in the last nibble: at most 16 distinct keys exist. */
const lastNibbleHash: Hasher = (id) => {
  const hash = new Uint8Array(ID_HASH_BYTES).fill(0x3c);
  hash[ID_HASH_BYTES - 1] =
    (hash[ID_HASH_BYTES - 1] & 0xf0) | (sha256Hash(id)[0] & 0x0f);
  return hash;
};

function entryFor(hasher: Hasher, id: string, version: number): IdEntry {
  return {
    hash: hasher(id),
    value: new TextEncoder().encode(`${id}#${version}`),
  };
}

/** The test-side oracle: the latest value of every key. */
class Oracle {
  readonly values = new Map<string, IdEntry>();

  apply(entries: readonly IdEntry[]): void {
    for (const entry of entries) this.values.set(hex(entry.hash), entry);
  }

  sorted(): Array<{ hash: string; value: string }> {
    return sortedByHash(this.values.values()).map((entry) => ({
      hash: hex(entry.hash),
      value: hex(entry.value),
    }));
  }
}

/** Updates in ascending order with unique keys, as the merge requires. */
function group(entries: IdEntry[]): IdEntry[] {
  const latest = new Map<string, IdEntry>();
  for (const entry of entries) latest.set(hex(entry.hash), entry);
  return sortedByHash(latest.values());
}

async function expectMatches(
  fixture: IdTrieFixture,
  oracle: Oracle,
  hasher: Hasher,
  absent: readonly string[],
): Promise<void> {
  const reader = fixture.reader();
  for (const [key, entry] of oracle.values) {
    const found = await reader.lookup(fixture.root, entry.hash);
    expect(found === undefined ? undefined : hex(found)).toBe(hex(entry.value));
    expect(key).toBe(hex(entry.hash));
  }
  for (const id of absent) {
    expect(await reader.lookup(fixture.root, hasher(id))).toBeUndefined();
  }
  expect(await collectEntries(reader, fixture.root)).toStrictEqual(
    oracle.sorted(),
  );
}

describe('id trie against a Map oracle', () => {
  const tempDir = useTempDir('id-trie-');

  async function runRandom(
    hasher: Hasher,
    seed: number,
    ids: number,
    groups: number,
  ) {
    const fixture = await IdTrieFixture.create(
      path.join(tempDir(), 'ids.llxj'),
    );
    const random = new SeededRandom(seed);
    const oracle = new Oracle();
    let version = 0;
    for (let at = 0; at < groups; at++) {
      const size = 1 + random.int(Math.max(1, Math.floor((ids / groups) * 2)));
      const updates = group(
        Array.from({ length: size }, () =>
          entryFor(hasher, `id-${random.int(ids)}`, version++),
        ),
      );
      await fixture.merge(updates);
      oracle.apply(updates);
    }
    return { fixture, oracle };
  }

  it('inserts, updates and looks up random ids, then reads the same after a reopen', async () => {
    const hasher = sha256Hash;
    const { fixture, oracle } = await runRandom(hasher, 1, 3000, 120);
    expect(oracle.values.size).toBeGreaterThan(1500);
    await expectMatches(fixture, oracle, hasher, ['absent-1', 'absent-2', 'x']);
    await fixture.close();
    const reopened = await reopenIdTrie(fixture.file);
    expect(await collectEntries(reopened.reader, reopened.root)).toStrictEqual(
      oracle.sorted(),
    );
    for (const entry of [...oracle.values.values()].slice(0, 200)) {
      const found = await reopened.reader.lookup(reopened.root, entry.hash);
      expect(found === undefined ? undefined : hex(found)).toBe(
        hex(entry.value),
      );
    }
    await reopened.close();
  });

  it('keeps the old version readable after later groups (copy on write)', async () => {
    const fixture = await IdTrieFixture.create(
      path.join(tempDir(), 'cow.llxj'),
    );
    const first = group(
      Array.from({ length: 200 }, (_, at) => entryFor(sha256Hash, `k${at}`, 0)),
    );
    await fixture.merge(first);
    const oldRoot = fixture.root;
    await fixture.merge(
      group(
        first.map((entry) => ({ hash: entry.hash, value: Uint8Array.of(9) })),
      ),
    );
    expect(fixture.root).not.toBe(oldRoot);
    const reader = fixture.reader();
    for (const entry of first) {
      const before = await reader.lookup(oldRoot, entry.hash);
      expect(before === undefined ? undefined : hex(before)).toBe(
        hex(entry.value),
      );
      const after = await reader.lookup(fixture.root, entry.hash);
      expect(after === undefined ? undefined : hex(after)).toBe('09');
    }
    await fixture.close();
  });

  it('splits through long shared prefixes when hashes collide on their first 20 nibbles', async () => {
    const { fixture, oracle } = await runRandom(sharedPrefixHash, 2, 700, 40);
    await expectMatches(fixture, oracle, sharedPrefixHash, ['nope', 'nada']);
    const depth = await trieDepth(fixture.reader(), fixture.root);
    expect(depth).toBeGreaterThanOrEqual(21);
    await fixture.close();
  });

  it('holds sixteen keys that differ in the last nibble and treats equal hashes as one key', async () => {
    const hasher = lastNibbleHash;
    const { fixture, oracle } = await runRandom(hasher, 3, 400, 30);
    expect(oracle.values.size).toBeLessThanOrEqual(16);
    expect(oracle.values.size).toBeGreaterThan(ID_TRIE_LEAF_CAPACITY);
    await expectMatches(fixture, oracle, hasher, []);
    const depth = await trieDepth(fixture.reader(), fixture.root);
    expect(depth).toBe(33);
    await fixture.close();
  });

  it('writes nothing for an update that changes no value', async () => {
    const fixture = await IdTrieFixture.create(
      path.join(tempDir(), 'same.llxj'),
    );
    const entries = group(
      Array.from({ length: 50 }, (_, at) => entryFor(sha256Hash, `s${at}`, 0)),
    );
    await fixture.merge(entries);
    const root = fixture.root;
    const again = await fixture.merge(entries);
    expect(again.records).toBe(0);
    expect(fixture.root).toBe(root);
    await fixture.close();
  });

  it('writes one node per level on the path of one new id', async () => {
    const fixture = await IdTrieFixture.create(
      path.join(tempDir(), 'path.llxj'),
    );
    await fixture.bulk(
      sortedByHash(
        Array.from({ length: 20_000 }, (_, at) =>
          entryFor(sha256Hash, `p${at}`, 0),
        ),
      ),
    );
    const depth = await trieDepth(fixture.reader(), fixture.root);
    const stats = await fixture.merge([entryFor(sha256Hash, 'brand-new', 1)]);
    expect(stats.records).toBeLessThanOrEqual(depth + 1);
    expect(stats.records).toBeGreaterThanOrEqual(depth - 1);
    expect(stats.bytes).toBeLessThan(depth * 1200);
    await fixture.close();
  });

  it('looks an id up in a few preads, and in fewer once the top levels are cached', async () => {
    const fixture = await IdTrieFixture.create(
      path.join(tempDir(), 'preads.llxj'),
    );
    const entries = sortedByHash(
      Array.from({ length: 20_000 }, (_, at) =>
        entryFor(sha256Hash, `r${at}`, 0),
      ),
    );
    await fixture.bulk(entries);
    const depth = await trieDepth(fixture.reader(), fixture.root);
    const cold = new BoundedIdNodeCache(0);
    const coldReader = fixture.reader(cold);
    const before = fixture.reads.reads;
    await coldReader.lookup(fixture.root, entries[7].hash);
    expect(fixture.reads.reads - before).toBeLessThanOrEqual(depth);
    expect(depth).toBeLessThanOrEqual(6);
    const warm = fixture.reader(new BoundedIdNodeCache());
    for (let at = 0; at < 2000; at++)
      await warm.lookup(fixture.root, entries[(at * 7) % entries.length].hash);
    const start = fixture.reads.reads;
    for (let at = 0; at < 1000; at++)
      await warm.lookup(fixture.root, entries[(at * 13) % entries.length].hash);
    expect((fixture.reads.reads - start) / 1000).toBeLessThanOrEqual(3);
    await fixture.close();
  });
});

describe('bulk build equals incremental insertion', () => {
  const tempDir = useTempDir('id-trie-bulk-');

  async function signatureOf(
    name: string,
    entries: readonly IdEntry[],
    mode: 'bulk' | 'single' | 'batches',
  ): Promise<{
    signature: string;
    bytes: number;
    items: Array<{ hash: string; value: string }>;
  }> {
    const fixture = await IdTrieFixture.create(
      path.join(tempDir(), `${name}-${mode}.llxj`),
    );
    const sorted = sortedByHash(entries);
    if (mode === 'bulk') {
      await fixture.bulk(sorted);
    } else if (mode === 'single') {
      const order = new SeededRandom(5);
      const shuffled = [...sorted].sort(() => order.next() - 0.5);
      for (const entry of shuffled) await fixture.merge([entry]);
    } else {
      const order = new SeededRandom(6);
      const shuffled = [...sorted].sort(() => order.next() - 0.5);
      for (let at = 0; at < shuffled.length; at += 37) {
        await fixture.merge(group(shuffled.slice(at, at + 37)));
      }
    }
    const reader = fixture.reader();
    const signature = await shapeSignature(reader, fixture.root);
    const items = await collectEntries(reader, fixture.root);
    const { size } = await stat(fixture.file);
    await fixture.close();
    return { signature, bytes: size, items };
  }

  for (const [name, hasher, count] of [
    ['sha', sha256Hash, 1500],
    ['prefix', sharedPrefixHash, 300],
  ] as const) {
    it(`builds one canonical trie for ${name} keys by bulk, by single inserts and by batches`, async () => {
      const entries = Array.from({ length: count }, (_, at) =>
        entryFor(hasher, `b${at}`, 0),
      );
      const bulk = await signatureOf(name, entries, 'bulk');
      const single = await signatureOf(name, entries, 'single');
      const batches = await signatureOf(name, entries, 'batches');
      expect(single.signature).toBe(bulk.signature);
      expect(batches.signature).toBe(bulk.signature);
      expect(single.items).toStrictEqual(bulk.items);
      expect(bulk.items.length).toBe(count);
      expect(bulk.bytes).toBeLessThan(single.bytes);
    });
  }

  it('refuses a bulk stream that is not strictly ascending', async () => {
    const fixture = await IdTrieFixture.create(
      path.join(tempDir(), 'order.llxj'),
    );
    const [first, second] = sortedByHash([
      entryFor(sha256Hash, 'a', 0),
      entryFor(sha256Hash, 'b', 0),
    ]);
    await expect(fixture.bulk([second, first])).rejects.toThrow(
      JournalFormatError,
    );
    await fixture.close();
    const again = await IdTrieFixture.create(path.join(tempDir(), 'dup.llxj'));
    await expect(again.bulk([first, first])).rejects.toThrow(
      JournalFormatError,
    );
    await again.close();
  });
});
