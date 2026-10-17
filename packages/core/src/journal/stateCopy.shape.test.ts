/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  copyDeps,
  growAfterCheckpoint,
  mapContentsAt,
  openStore,
  populatedSource,
  setState,
} from './__tests__/support/copyFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { ID_TRIE_LEAF_CAPACITY } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import type { JournalStore } from './journalStore.js';
import type { RecordAccess } from './recordAccess.js';
import { cloneVersion, compactionCopy } from './versionCopy.js';
import { accessOf } from './__tests__/support/pinnedAccess.js';

const CHECKPOINTS = 60;
const DROPPED_PREFIXES = ['ckpt:', 'mirror:', 'rel:'];

/**
 * Checks the shape rule of the id trie on the map at `root`: a subtree of
 * eight or fewer entries is a leaf and a larger one an internal node, which is
 * what a build from the same keys gives. Returns the entry count.
 */
async function checkShape(
  reader: IdTrieReader,
  offset: number,
): Promise<number> {
  const node = await reader.readNode(offset);
  if (node.kind === 'leaf') return node.entries.length;
  let total = 0;
  for (const child of node.children) total += await checkShape(reader, child);
  expect(total).toBeGreaterThan(ID_TRIE_LEAF_CAPACITY);
  return total;
}

function survivors(state: Map<string, string>): Map<string, string> {
  return new Map(
    [...state].filter(
      ([key]) => !DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}

describe('state map copy keeps the shape of a trie built from the surviving keys (design 3.3, 4.11)', () => {
  const directory = useTempDir('journal-state-shape-');

  async function session(extraKeys: number): Promise<JournalStore> {
    const store = await populatedSource(path.join(directory(), 'source.llxj'));
    if (extraKeys > 0) {
      await store.commit(
        Array.from({ length: extraKeys }, (_, at) =>
          setState(`extra:${at}`, `value ${at}`),
        ),
      );
    }
    for (let index = 0; index < CHECKPOINTS; index++) {
      await growAfterCheckpoint(store, `k${index}`, 0);
      if (index % 7 === 0) {
        await store.commit([setState(`title`, `title after ${index}`)]);
      }
    }
    return store;
  }

  for (const [name, extraKeys] of [
    ['a map that falls to a leaf once the checkpoints are dropped', 0],
    ['a map that stays an internal node with the checkpoints dropped', 30],
  ] as const) {
    it(`gives every copied version the shape and the entries of its surviving keys: ${name}`, async () => {
      const source = await session(extraKeys);
      const sourceAccess: RecordAccess = await accessOf(source);
      const current = source.published;
      if (current === undefined) throw new Error('nothing is published');
      const result = await compactionCopy(
        sourceAccess,
        current,
        path.join(directory(), 'compacted.llxj'),
        copyDeps(),
      );
      const clone = await cloneVersion(
        sourceAccess,
        current,
        path.join(directory(), 'clone.llxj'),
        copyDeps(),
      );
      const expected = survivors(
        await mapContentsAt(sourceAccess, current.roots.stateRoot),
      );
      const expectedAt = new Map<number, Map<string, string>>();
      for (const copied of result.versions) {
        const saved = await source.readVersion(copied.sourceOffset);
        expectedAt.set(
          copied.offset,
          survivors(await mapContentsAt(sourceAccess, saved.roots.stateRoot)),
        );
      }
      await source.close();

      const compacted = await openStore(result.path);
      const cloned = await openStore(clone.path);
      let checked = 0;
      for (const copied of result.versions.slice(0, -1)) {
        const version = await compacted.readVersion(copied.offset);
        const access = await accessOf(compacted);
        const reader = new IdTrieReader(access, new BoundedIdNodeCache());
        const state = await mapContentsAt(access, version.roots.stateRoot);
        expect(await checkShape(reader, version.roots.stateRoot)).toBe(
          state.size,
        );
        const wanted = expectedAt.get(copied.offset);
        if (wanted === undefined) throw new Error('no expected state');
        expect(state).toStrictEqual(wanted);
        checked += 1;
      }
      expect(checked).toBe(CHECKPOINTS);

      const cloneVersionRecord = cloned.published;
      if (cloneVersionRecord === undefined) throw new Error('no clone');
      const cloneRoot = cloneVersionRecord.roots.stateRoot;
      const cloneAccess = await accessOf(cloned);
      const cloneState = await mapContentsAt(cloneAccess, cloneRoot);
      expect(cloneState).toStrictEqual(expected);
      expect(
        await checkShape(
          new IdTrieReader(cloneAccess, new BoundedIdNodeCache()),
          cloneRoot,
        ),
      ).toBe(expected.size);
      await compacted.close();
      await cloned.close();
    }, 120_000);
  }
});
