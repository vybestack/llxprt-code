/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import { sha256KeyHash } from '../../idKeys.js';
import { BoundedIdNodeCache } from '../../idTrieCache.js';
import { JournalStore } from '../../journalStore.js';
import { readMapEntries, readValueBody } from '../../mapEntries.js';
import type { VersionEdit } from '../../groupEdits.js';
import type { RecordAccess } from '../../recordAccess.js';
import type { CopyDependencies } from '../../versionCopy.js';
import { FAKE_NOW_MS, testJournalSeams } from './journalFixtures.js';
import { SeededRandom } from './seededRandom.js';
import {
  appendEach,
  draftRow,
  scenarioDrafts,
  storeDeps,
} from './storeFixtures.js';
import type { StoreSnapshot } from './storeSnapshot.js';

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

export function copyDeps(): CopyDependencies {
  return {
    journal: testJournalSeams().dependencies,
    hasher: sha256KeyHash,
  };
}

/**
 * Real files like `copyDeps`, with nothing recorded. The seams of `copyDeps`
 * keep an event for every write and flush the copy makes, which is a list
 * that grows with the number of versions, so a heap measurement of a copy
 * must not use them.
 */
export function copyDepsWithoutEventLog(): CopyDependencies {
  const random = new SeededRandom(1);
  return {
    journal: {
      open: (path, flags) => fsp.open(path, flags),
      flush: () => undefined,
      nowMs: () => FAKE_NOW_MS,
      random: (length) => random.bytes(length),
    },
    hasher: sha256KeyHash,
  };
}

export function openStore(file: string): Promise<JournalStore> {
  return JournalStore.open(file, storeDeps());
}

export function setState(key: string, value: string): VersionEdit {
  return { kind: 'setState', key, value: UTF8.encode(value) };
}

/** The map rooted at `root` as text, key to value. */
export async function mapContentsAt(
  access: RecordAccess,
  root: number,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for await (const entry of readMapEntries(
    access,
    new BoundedIdNodeCache(),
    root,
  )) {
    found.set(
      entry.key,
      UTF8_DECODER.decode(await readValueBody(access, entry.head)),
    );
  }
  return found;
}

/** A map of the published version as text: `state` for the state map, `meta` for the versioned meta map. */
export async function mapContents(
  store: JournalStore,
  which: 'state' | 'meta',
): Promise<Map<string, string>> {
  const read = await store.openRead();
  try {
    const { version } = read;
    if (version === undefined) throw new Error('nothing is published');
    const root =
      which === 'state' ? version.roots.stateRoot : version.roots.metaRoot;
    return await mapContentsAt(read.access, root);
  } finally {
    read.close();
  }
}

/** The owner dictionary, start metadata and title a session carries (design 3.5). */
export const SESSION_STATE: ReadonlyArray<readonly [string, string]> = [
  ['owner:1', 'agent:alpha'],
  ['owner:2', 'agent:beta'],
  ['owner:3', 'subagent:gamma/7'],
  ['start:provider', 'zai'],
  ['start:model', 'glm-5.3'],
  ['title', 'Session title'],
  ['fork:source', 'parent-session'],
];

const OWNERS = [1, 2, 1, 2, 3, 0] as const;

/** Six rows owned by three agents and one unowned, with the session state map a real session has. */
export async function populatedSource(file: string): Promise<JournalStore> {
  const store = await JournalStore.create(file, storeDeps());
  await store.commit(SESSION_STATE.map(([key, value]) => setState(key, value)));
  await appendEach(
    store,
    scenarioDrafts().map((draft, index) => ({
      ...draft,
      owner: OWNERS[index],
    })),
  );
  return store;
}

/** More rows after a checkpoint, so the checkpoint and the current version differ. */
export async function growAfterCheckpoint(
  store: JournalStore,
  id: string,
  rows: number,
): Promise<void> {
  await store.commit([
    {
      kind: 'checkpoint',
      id,
      name: `checkpoint ${id}`,
      createdAtMs: 1_700_000,
    },
  ]);
  await appendEach(
    store,
    Array.from({ length: rows }, (_, index) =>
      draftRow({
        owner: 1 + (index % 3),
        calls: [`${id}-${index}`],
        text: `${id} ${index}`,
      }),
    ),
  );
}

/**
 * A snapshot with the file offsets taken out, so a source and its clone can
 * be compared: everything else a reader can tell must be equal.
 */
export function withoutOffsets(snapshot: StoreSnapshot): unknown {
  return {
    nextLabel: snapshot.nextLabel,
    aggregate: snapshot.aggregate,
    facts: snapshot.facts,
    meta: snapshot.meta,
    rows: snapshot.rows.map((row) => ({
      ...row,
      entry: {
        ...row.entry,
        recordOffset: 0,
        lensRef: row.entry.lensRef.map((ref) => ref !== 0),
      },
    })),
  };
}

export function removeFile(file: string): Promise<void> {
  return fsp.rm(file, { force: true });
}
