/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  checkpointKey,
  parseCheckpointDescriptor,
} from './checkpointDescriptor.js';
import { MUTATION } from './recordKinds.js';
import type { JournalStore } from './journalStore.js';
import { IdFactQueries } from './idFactQueries.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { IdTrieReader } from './idTrieReader.js';
import { createFileHandleReader } from './positionalFile.js';
import { createRecordAccess } from './recordAccess.js';
import {
  cloneCheckpoint,
  cloneVersion,
  compactionCopy,
} from './versionCopy.js';
import {
  copyDeps,
  growAfterCheckpoint,
  mapContents,
  mapContentsAt,
  openStore,
  populatedSource,
  setState,
  withoutOffsets,
} from './__tests__/support/copyFixtures.js';
import { realDeps } from './__tests__/support/idFactFixture.js';
import { OffsetAudit } from './__tests__/support/offsetAudit.js';
import {
  appendEach,
  draftRow,
  labelsOf,
} from './__tests__/support/storeFixtures.js';
import { snapshotStore } from './__tests__/support/storeSnapshot.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const IDS = ['a', 'b', 'c', 'd', 'e', 'c1-0', 'c1-1', 'c2-0', 'c2-1', 'c2-2'];

function current(store: JournalStore) {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

describe('compaction copy (design 4.11 steps 3 and 4)', () => {
  const directory = useTempDir('journal-compaction-');
  const file = (name: string) => path.join(directory(), name);

  /**
   * Three state maps that differ: checkpoint c1 has agents 1 to 3 and the
   * first title, c2 adds agent 4, and the current version has a new title.
   */
  async function sessionWithTwoCheckpoints(): Promise<JournalStore> {
    const store = await populatedSource(file('source.llxj'));
    await growAfterCheckpoint(store, 'c1', 2);
    const labels = await labelsOf(store);
    await store.commit([
      { kind: 'owner', changes: [{ label: labels[2], owner: 3 }] },
      setState('owner:4', 'agent:delta'),
    ]);
    await growAfterCheckpoint(store, 'c2', 3);
    await store.commit([setState('title', 'Renamed after both checkpoints')]);
    return store;
  }

  it('gives a checkpoint restore before and after the copy the same history, facts and owner identities', async () => {
    const source = await sessionWithTwoCheckpoints();
    const deps = copyDeps();
    const before = new Map<string, Awaited<ReturnType<typeof capture>>>();
    for (const id of ['c1', 'c2']) {
      const restored = await cloneCheckpoint(
        source.recordAccess(),
        current(source),
        id,
        file(`before-${id}.llxj`),
        deps,
      );
      before.set(id, await capture(restored.path));
    }
    const compacted = await compactionCopy(
      source.recordAccess(),
      current(source),
      file('compacted.llxj'),
      deps,
    );
    await source.close();
    await fsp.rm(file('source.llxj'));

    const store = await openStore(compacted.path);
    for (const id of ['c1', 'c2']) {
      const restored = await cloneCheckpoint(
        store.recordAccess(),
        current(store),
        id,
        file(`after-${id}.llxj`),
        deps,
      );
      const after = await capture(restored.path);
      const earlier = before.get(id);
      if (earlier === undefined) throw new Error(`no capture of ${id}`);
      expect(after).toStrictEqual(earlier);
    }
    const c1 = before.get('c1');
    const c2 = before.get('c2');
    // The checkpoints differ from each other and from the current version, so the equality above says something.
    expect(c1?.state.get('owner:4')).toBeUndefined();
    expect(c2?.state.get('owner:4')).toBe('agent:delta');
    expect(c1?.state.get('title')).toBe('Session title');
    expect(c1?.rows).not.toStrictEqual(c2?.rows);
    await store.close();
  });

  async function capture(restored: string) {
    const store = await openStore(restored);
    const snapshot = await snapshotStore(store, IDS);
    const captured = {
      snapshot: withoutOffsets(snapshot),
      rows: snapshot.rows.map((row) => `${row.entry.label}:${row.entry.owner}`),
      state: await mapContents(store, 'state'),
      meta: await mapContents(store, 'meta'),
    };
    await store.close();
    return captured;
  }

  it('keeps every version its own owner dictionary: each checkpoint and the current version read back the map they had', async () => {
    const source = await sessionWithTwoCheckpoints();
    const sourceAccess = source.recordAccess();
    const sourceCurrent = current(source);
    const sourceState = await mapContents(source, 'state');
    const descriptors = new Map(
      await Promise.all(
        ['c1', 'c2'].map(async (id) => {
          const raw = await source.getState(checkpointKey(id));
          if (raw === undefined) throw new Error(`no checkpoint ${id}`);
          return [id, parseCheckpointDescriptor(raw)] as const;
        }),
      ),
    );
    const savedStates = new Map<string, Map<string, string>>();
    for (const [id, descriptor] of descriptors) {
      const saved = await source.readVersion(descriptor.trailerOffset);
      savedStates.set(
        id,
        await mapContentsAt(sourceAccess, saved.roots.stateRoot),
      );
    }
    const result = await compactionCopy(
      sourceAccess,
      sourceCurrent,
      file('compacted.llxj'),
      copyDeps(),
    );
    await source.close();
    await fsp.rm(file('source.llxj'));

    const store = await openStore(result.path);
    const version = current(store);
    expect(version.commitSeq).toBe(sourceCurrent.commitSeq);
    expect(version.mutation).toBe(MUTATION.clone);
    expect(version.parent).toBe(0);
    expect(result.versions).toHaveLength(3);
    const state = await mapContents(store, 'state');
    const expectedCurrent = new Map(sourceState);
    for (const id of ['c1', 'c2']) expectedCurrent.delete(checkpointKey(id));
    for (const key of [...state.keys()]) {
      if (key.startsWith('ckpt:')) state.delete(key);
    }
    expect(state).toStrictEqual(expectedCurrent);
    let liveBytes = 0;
    for (const [id, descriptor] of descriptors) {
      const stored = await store.getState(checkpointKey(id));
      if (stored === undefined) throw new Error(`checkpoint ${id} was dropped`);
      const moved = parseCheckpointDescriptor(stored);
      expect(moved).toMatchObject({
        name: descriptor.name,
        commitSeq: descriptor.commitSeq,
        createdAtMs: descriptor.createdAtMs,
        liveBytes: descriptor.liveBytes,
      });
      liveBytes += descriptor.liveBytes;
      const saved = await store.readVersion(moved.trailerOffset);
      expect(saved.commitSeq).toBe(descriptor.commitSeq);
      expect(saved.roots.stateRoot).not.toBe(0);
      const kept = await mapContentsAt(
        store.recordAccess(),
        saved.roots.stateRoot,
      );
      expect(kept).toStrictEqual(withoutLocalKeys(savedStates.get(id)));
      const owners = [...kept].filter(([key]) => key.startsWith('owner:'));
      expect(owners.length).toBeGreaterThan(0);
      expect(owners.map(([key]) => [key, sourceState.get(key)])).toStrictEqual(
        owners,
      );
    }
    expect(version.ckptBytes).toBe(liveBytes);
    await store.close();
  });

  it('points every offset of the compacted file, for the current version and for each checkpoint, at a record written earlier in it', async () => {
    const source = await sessionWithTwoCheckpoints();
    const result = await compactionCopy(
      source.recordAccess(),
      current(source),
      file('compacted.llxj'),
      copyDeps(),
    );
    await source.close();
    await fsp.rm(file('source.llxj'));
    const store = await openStore(result.path);
    const audit = new OffsetAudit(store.recordAccess());
    for (const copied of result.versions) {
      await audit.walkVersion(await store.readVersion(copied.offset));
    }
    const met = [...audit.checked].map(
      ([entry]) => `${entry.record}.${entry.field}`,
    );
    expect(met).toContain('CheckpointDescriptor.trailerOffset');
    expect(met).toContain('TrailerHeader.rowRoot');
    expect(met).toContain('StateMapEntry.valueRef');
    await store.close();
  });

  it('writes no relocation entry for a history with no checkpoint, and the one version equals a clone of it', async () => {
    const source = await populatedSource(file('source.llxj'));
    const result = await compactionCopy(
      source.recordAccess(),
      current(source),
      file('compacted.llxj'),
      copyDeps(),
    );
    const clone = await cloneVersion(
      source.recordAccess(),
      current(source),
      file('clone.llxj'),
      copyDeps(),
    );
    expect(result.versions).toHaveLength(1);
    expect(result.relocation.entries).toBe(0);
    expect(result.relocation.batches).toBe(0);
    const compacted = await openStore(result.path);
    const cloned = await openStore(clone.path);
    expect(withoutOffsets(await snapshotStore(compacted, IDS))).toStrictEqual(
      withoutOffsets(await snapshotStore(cloned, IDS)),
    );
    expect(current(compacted).commitSeq).toBe(current(source).commitSeq);
    await source.close();
    await compacted.close();
    await cloned.close();
  });

  it('refuses a checkpoint whose descriptor and trailer disagree about the version', async () => {
    const source = await populatedSource(file('source.llxj'));
    await growAfterCheckpoint(source, 'c1', 1);
    const raw = await source.getState(checkpointKey('c1'));
    if (raw === undefined) throw new Error('no checkpoint');
    const descriptor = parseCheckpointDescriptor(raw);
    await source.commit([
      setState(
        checkpointKey('c1'),
        JSON.stringify({ ...descriptor, commitSeq: descriptor.commitSeq + 5 }),
      ),
    ]);
    await expect(
      compactionCopy(
        source.recordAccess(),
        current(source),
        file('bad.llxj'),
        copyDeps(),
      ),
    ).rejects.toThrow('says commitSeq');
    await source.close();
  });
});

/** The state a checkpoint version carries: the owner dictionary and the session metadata, and no checkpoint, mirror or release entries. */
function withoutLocalKeys(
  state: Map<string, string> | undefined,
): Map<string, string> {
  return new Map(
    [...(state ?? [])].filter(
      ([key]) =>
        !key.startsWith('ckpt:') &&
        !key.startsWith('mirror:') &&
        !key.startsWith('rel:'),
    ),
  );
}

describe('memoization of shared records (design 4.8, several versions)', () => {
  const directory = useTempDir('journal-memo-');
  const file = (name: string) => path.join(directory(), name);
  const VERSIONS = 12;
  const BASE_ROWS = 1500;
  /** What one more version may add to a file beyond the records it does not share: a spine, its trie paths, state map and trailer. */
  const PER_VERSION_BUDGET = 96 * 1024;

  async function longSession(): Promise<JournalStore> {
    const store = await populatedSource(file('source.llxj'));
    for (let from = 0; from < BASE_ROWS; from += 250) {
      await appendEach(
        store,
        Array.from({ length: 250 }, (_, at) =>
          draftRow({ owner: 1 + (at % 3), calls: [`base-${from + at}`] }),
        ),
      );
    }
    for (let version = 0; version < VERSIONS; version++) {
      await growAfterCheckpoint(store, `v${version}`, 2);
    }
    return store;
  }

  it('copies the records the versions share once: the file holds about one copy of the history plus a delta per version, and not one copy per version', async () => {
    const source = await longSession();
    const deps = copyDeps();
    const sourceCurrent = current(source);
    const single = await cloneVersion(
      source.recordAccess(),
      sourceCurrent,
      file('single.llxj'),
      deps,
    );
    const compacted = await compactionCopy(
      source.recordAccess(),
      sourceCurrent,
      file('compacted.llxj'),
      deps,
    );
    expect(compacted.versions).toHaveLength(VERSIONS + 1);

    const singleBytes = (await fsp.stat(single.path)).size;
    const compactedBytes = (await fsp.stat(compacted.path)).size;
    expect(compactedBytes).toBeLessThan(
      singleBytes + VERSIONS * PER_VERSION_BUDGET,
    );
    // Every ROW record of the history is in the file once.
    expect(compacted.stats.copied.ROW).toBe(single.stats.copied.ROW);
    expect(compacted.stats.memoHits).toBeGreaterThan(VERSIONS * 10);

    // Control: a copy of every version on its own, with nothing shared, takes a copy of the history for each.
    let separately = 0;
    for (const [index, copied] of compacted.versions.entries()) {
      const saved = await source.readVersion(copied.sourceOffset);
      const alone = await cloneVersion(
        source.recordAccess(),
        saved,
        file(`alone-${index}.llxj`),
        deps,
      );
      separately += (await fsp.stat(alone.path)).size;
    }
    expect(separately).toBeGreaterThan(
      singleBytes + VERSIONS * PER_VERSION_BUDGET,
    );
    expect(separately).toBeGreaterThan(compactedBytes * 4);
    await source.close();
  });

  it('keeps the old-to-new offsets in a trie in the new file, and every entry it holds is the offset the row has there', async () => {
    const source = await longSession();
    const sourceRows = new Map<bigint, number>();
    for await (const entry of source.rows()) {
      sourceRows.set(entry.label, entry.recordOffset);
    }
    const result = await compactionCopy(
      source.recordAccess(),
      current(source),
      file('compacted.llxj'),
      copyDeps(),
    );
    await source.close();
    expect(result.relocation.batches).toBeGreaterThan(0);
    expect(result.relocation.root).not.toBe(0);

    const store = await openStore(result.path);
    const copiedRows = new Map<bigint, number>();
    for await (const entry of store.rows()) {
      copiedRows.set(entry.label, entry.recordOffset);
    }
    const handle = await fsp.open(result.path, 'r');
    const reader = new IdTrieReader(
      createRecordAccess(result.path, createFileHandleReader(handle), {
        selfOffset: 0,
        durableEnd: result.relocation.readableEnd,
      }),
      new BoundedIdNodeCache(),
    );
    const deps = realDeps();
    const queries = new IdFactQueries(
      { get: (hash) => reader.lookup(result.relocation.root, hash) },
      deps,
    );
    let found = 0;
    for (const [label, oldOffset] of sourceRows) {
      const relocated = await queries.relocation(oldOffset);
      if (relocated === undefined) continue;
      found += 1;
      const copiedOffset = copiedRows.get(label);
      if (copiedOffset === undefined) {
        throw new Error(`row ${label} is not in the compacted file`);
      }
      expect(relocated).toBe(copiedOffset);
    }
    expect(found).toBeGreaterThan(result.relocation.entries / 4);
    expect(found).toBeGreaterThan(100);
    await handle.close();
    await store.close();
  });
});
