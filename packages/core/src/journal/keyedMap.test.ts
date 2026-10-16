/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { BoundedIdNodeCache, ID_NODE_CACHE_BYTES } from './idTrieCache.js';
import { sha256KeyHash } from './idKeys.js';
import {
  KeyedMapBatch,
  KeyedMapReader,
  MAP_KEY_MAX_BYTES,
  MAP_VALUE_MAX_BYTES,
  type MapKind,
} from './keyedMap.js';
import { openJournalReadOnly } from './journalReader.js';
import { createJournal } from './journalWriterOpen.js';
import {
  trailerStateFor,
  testJournalSeams,
} from './__tests__/support/journalFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import { UnboundedIdNodeCache } from './__tests__/support/unboundedIdNodeCache.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { createRecordAccess } from './recordAccess.js';
import type { PositionalReader } from './positionalFile.js';
import { createFileHandleReader } from './positionalFile.js';
import * as fsp from 'node:fs/promises';

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

interface Roots {
  meta: number;
  state: number;
}

/** Commits groups that hold only the meta map and the state map. */
async function openMapJournal(file: string) {
  const seams = testJournalSeams();
  const writer = await createJournal(file, seams.dependencies);
  const handle = await fsp.open(file, 'r');
  const source = createFileHandleReader(handle);
  const roots: Roots = { meta: 0, state: 0 };
  let groups = 0;
  const readerFor = (kind: MapKind, cache = new BoundedIdNodeCache()) => {
    const trailer = writer.published?.trailer;
    const access =
      trailer === undefined
        ? undefined
        : createRecordAccess(file, source, trailer);
    return new KeyedMapReader(access, cache, kind, sha256KeyHash);
  };
  const commit = async (
    kind: MapKind,
    sets: ReadonlyArray<readonly [string, string]>,
    cache?: BoundedIdNodeCache,
  ) => {
    const seed = ++groups;
    const before = { ...roots };
    const reader = readerFor(kind, cache);
    await writer.commitStreamedGroup(async (appender) => {
      const batch = new KeyedMapBatch(reader, roots[kind]);
      for (const [key, value] of sets) batch.set(key, ENCODER.encode(value));
      before[kind] = await batch.commit(appender);
      return trailerStateFor(seed, {
        metaRoot: before.meta,
        stateRoot: before.state,
      });
    });
    roots[kind] = before[kind];
  };
  return {
    roots,
    readerFor,
    commit,
    close: async () => {
      await writer.close();
      await handle.close();
    },
  };
}

function countingReader(inner: PositionalReader) {
  const counter = { reads: 0 };
  const reader: PositionalReader = {
    readAt: (position, length) => {
      counter.reads += 1;
      return inner.readAt(position, length);
    },
  };
  return { counter, reader };
}

describe('meta map and state map', () => {
  const directory = useTempDir('keyed-map-');

  it('agree with a Map oracle over inserts and updates, then after a reopen', async () => {
    const file = path.join(directory(), 'maps.llxj');
    const journal = await openMapJournal(file);
    const random = new SeededRandom(11);
    const oracle: Record<MapKind, Map<string, string>> = {
      meta: new Map(),
      state: new Map(),
    };
    for (let group = 0; group < 12; group++) {
      const kind: MapKind = group % 2 === 0 ? 'meta' : 'state';
      const sets: Array<readonly [string, string]> = [];
      for (let at = 0; at < 40; at++) {
        const key = `key:${random.int(150)}`;
        const value = `${kind}-${group}-${at}-${random.int(1e6)}`;
        sets.push([key, value]);
        oracle[kind].set(key, value);
      }
      await journal.commit(kind, sets);
    }
    await journal.close();

    const opened = await openJournalReadOnly(file);
    const trailer = opened.trailer;
    if (trailer === undefined) throw new Error('no trailer');
    for (const kind of ['meta', 'state'] as const) {
      const reader = new KeyedMapReader(
        opened,
        new BoundedIdNodeCache(),
        kind,
        sha256KeyHash,
      );
      const root = kind === 'meta' ? trailer.metaRoot : trailer.stateRoot;
      for (const [key, value] of oracle[kind]) {
        const found = await reader.get(root, key);
        expect(found && DECODER.decode(found)).toBe(value);
      }
      expect(await reader.get(root, 'key:absent')).toBeUndefined();
    }
    await opened.close();
  });

  it('keep the two maps apart: one key holds different values in each', async () => {
    const file = path.join(directory(), 'apart.llxj');
    const journal = await openMapJournal(file);
    await journal.commit('meta', [['title', 'meta side']]);
    await journal.commit('state', [['title', 'state side']]);
    const meta = await journal
      .readerFor('meta')
      .get(journal.roots.meta, 'title');
    const state = await journal
      .readerFor('state')
      .get(journal.roots.state, 'title');
    expect(meta && DECODER.decode(meta)).toBe('meta side');
    expect(state && DECODER.decode(state)).toBe('state side');
    await journal.close();
  });

  it('refuse a key or value past its bound and an empty key', async () => {
    const file = path.join(directory(), 'bounds.llxj');
    const journal = await openMapJournal(file);
    const reader = journal.readerFor('meta');
    const batch = new KeyedMapBatch(reader, 0);
    expect(() => batch.set('', new Uint8Array(1))).toThrow(/1 to 256 bytes/);
    expect(() =>
      batch.set('k'.repeat(MAP_KEY_MAX_BYTES + 1), new Uint8Array(1)),
    ).toThrow(/1 to 256 bytes/);
    expect(() =>
      batch.set('k', new Uint8Array(MAP_VALUE_MAX_BYTES + 1)),
    ).toThrow(/holds at most/);
    batch.set(
      'k'.repeat(MAP_KEY_MAX_BYTES),
      new Uint8Array(MAP_VALUE_MAX_BYTES),
    );
    await journal.close();
  });

  it('read a value later in the same group that an earlier set wrote', async () => {
    const file = path.join(directory(), 'overlay.llxj');
    const journal = await openMapJournal(file);
    await journal.commit('meta', [['count', '1']]);
    const batch = new KeyedMapBatch(
      journal.readerFor('meta'),
      journal.roots.meta,
    );
    expect(DECODER.decode((await batch.get('count')) ?? new Uint8Array())).toBe(
      '1',
    );
    batch.set('count', ENCODER.encode('2'));
    expect(DECODER.decode((await batch.get('count')) ?? new Uint8Array())).toBe(
      '2',
    );
    await journal.close();
  });

  it('take a few preads for a cold lookup and none for a warm one, through a capped cache', async () => {
    const file = path.join(directory(), 'cost.llxj');
    const journal = await openMapJournal(file);
    const sets: Array<readonly [string, string]> = [];
    for (let index = 0; index < 3000; index++) {
      sets.push([`entry:${index}`, `value-${index}-${'x'.repeat(40)}`]);
    }
    for (let at = 0; at < sets.length; at += 500) {
      await journal.commit('state', sets.slice(at, at + 500));
    }
    await journal.close();

    const opened = await openJournalReadOnly(file);
    const trailer = opened.trailer;
    if (trailer === undefined) throw new Error('no trailer');
    const handle = await fsp.open(file, 'r');
    const { counter, reader: source } = countingReader(
      createFileHandleReader(handle),
    );
    const cache = new BoundedIdNodeCache();
    const access = createRecordAccess(file, source, trailer);
    const map = new KeyedMapReader(access, cache, 'state', sha256KeyHash);
    const cold = counter.reads;
    expect(await map.get(trailer.stateRoot, 'entry:1234')).toBeDefined();
    const coldReads = counter.reads - cold;
    expect(coldReads).toBeLessThanOrEqual(10);
    const warm = counter.reads;
    expect(await map.get(trailer.stateRoot, 'entry:1234')).toBeDefined();
    expect(counter.reads - warm).toBe(0);

    for (let index = 0; index < 3000; index++) {
      await map.get(trailer.stateRoot, `entry:${index}`);
    }
    expect(cache.bytes).toBeLessThanOrEqual(ID_NODE_CACHE_BYTES);
    await handle.close();
    await opened.close();
  });

  it('trap: a cache that keeps everything fails the cap', async () => {
    const file = path.join(directory(), 'trap.llxj');
    const journal = await openMapJournal(file);
    const sets: Array<readonly [string, string]> = [];
    for (let index = 0; index < 3000; index++) {
      sets.push([`entry:${index}`, `value-${index}-${'x'.repeat(40)}`]);
    }
    for (let at = 0; at < sets.length; at += 500) {
      await journal.commit('state', sets.slice(at, at + 500));
    }
    await journal.close();
    const opened = await openJournalReadOnly(file);
    const trailer = opened.trailer;
    if (trailer === undefined) throw new Error('no trailer');
    const trap = new UnboundedIdNodeCache();
    const map = new KeyedMapReader(opened, trap, 'state', sha256KeyHash);
    for (let index = 0; index < 3000; index++) {
      await map.get(trailer.stateRoot, `entry:${index}`);
    }
    expect(trap.bytes).toBeGreaterThan(ID_NODE_CACHE_BYTES);
    await opened.close();
  });
});
