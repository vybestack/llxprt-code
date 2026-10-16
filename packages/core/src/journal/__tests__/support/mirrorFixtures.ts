/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { expect } from 'bun:test';
import { JournalStore } from '../../journalStore.js';
import { MirrorFanout } from '../../mirrorFanout.js';
import { accepts } from '../../ownerRules.js';
import type { RowEntry } from '../../rowEntry.js';
import { testJournalSeams, type Failures } from './journalFixtures.js';
import { storeDeps } from './storeFixtures.js';

/** A digest of the `ROW` record an entry points at: its kind header and body, which is what must be the same in every file. */
export async function rowRecordDigest(
  store: JournalStore,
  entry: RowEntry,
): Promise<string> {
  const access = store.recordAccess();
  const head = await access.readRecordHead(entry.recordOffset, 'ROW');
  const hash = createHash('sha256').update(head.kindHeader);
  for await (const chunk of access.readRecordBody(head, undefined, 'ROW')) {
    hash.update(chunk);
  }
  return hash.digest('base64');
}

/** The label and record digest of every live row, in label order. */
export async function rowDigests(
  store: JournalStore,
  keep: (entry: RowEntry) => boolean = () => true,
): Promise<Array<[bigint, string]>> {
  const rows: Array<[bigint, string]> = [];
  for await (const entry of store.rows()) {
    if (keep(entry))
      rows.push([entry.label, await rowRecordDigest(store, entry)]);
  }
  return rows;
}

/** A mirror equals the filtered primary: the same labels, and the same `ROW` bytes under each. */
export async function expectMirrorEqualsFiltered(
  primary: JournalStore,
  mirror: JournalStore,
  owner: number,
): Promise<void> {
  const expected = await rowDigests(primary, (entry) =>
    accepts(owner, entry.owner),
  );
  const actual = await rowDigests(mirror);
  expect(actual.map(([label]) => label)).toStrictEqual(
    expected.map(([label]) => label),
  );
  expect(actual).toStrictEqual(expected);
  expect(mirror.published?.rows ?? 0).toBe(expected.length);
}

export interface MirrorRig {
  readonly primary: JournalStore;
  readonly fanout: MirrorFanout;
  readonly mirrors: ReadonlyMap<number, JournalStore>;
  readonly files: ReadonlyMap<number, string>;
  readonly primaryFile: string;
  closeAll(): Promise<void>;
}

export interface RigOptions {
  /** Injected faults for the mirror files of some owners. */
  readonly failures?: ReadonlyMap<number, Failures>;
  /** Attach the mirrors now (the default), or leave that to the test. */
  readonly attach?: boolean;
}

/** A primary journal, a fan-out over it, and a mirror file for each owner. */
export async function rigWithMirrors(
  directory: string,
  owners: readonly number[],
  options: RigOptions = {},
): Promise<MirrorRig> {
  const primaryFile = path.join(directory, 'primary.llxj');
  const primary = await JournalStore.create(primaryFile, storeDeps());
  const fanout = new MirrorFanout(primary);
  const mirrors = new Map<number, JournalStore>();
  const files = new Map<number, string>();
  for (const owner of owners) {
    const file = path.join(directory, `mirror-${owner}.llxj`);
    const seams = testJournalSeams(options.failures?.get(owner));
    const store = await JournalStore.create(file, storeDeps({ seams }));
    mirrors.set(owner, store);
    files.set(owner, file);
    if (options.attach !== false) await fanout.attach(store, owner);
  }
  return {
    primary,
    fanout,
    mirrors,
    files,
    primaryFile,
    closeAll: async () => {
      await primary.close();
      for (const store of mirrors.values()) await store.close();
    },
  };
}

/** Every mirror equals the filtered primary. */
export async function expectAllMirrorsEqual(rig: MirrorRig): Promise<void> {
  for (const [owner, mirror] of rig.mirrors) {
    await expectMirrorEqualsFiltered(rig.primary, mirror, owner);
  }
}
