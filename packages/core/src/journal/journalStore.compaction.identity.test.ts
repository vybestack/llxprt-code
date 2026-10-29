/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';
import { JournalStore } from './journalStore.js';
import { MirrorFanout } from './mirrorFanout.js';
import {
  expectMirrorEqualsFiltered,
  rigWithMirrors,
  type MirrorRig,
} from './__tests__/support/mirrorFixtures.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const A = 1;
const B = 2;
const AGENTS = [A, B] as const;

function group(tag: string) {
  return {
    kind: 'append' as const,
    rows: [
      draftRow({ owner: A, text: `${tag} a` }),
      draftRow({ owner: B, text: `${tag} b` }),
      draftRow({ owner: 0, text: `${tag} shared` }),
    ],
  };
}

async function sizeOf(file: string | undefined): Promise<number> {
  if (file === undefined) throw new Error('no file');
  return (await fsp.stat(file)).size;
}

interface Reopened {
  readonly primary: JournalStore;
  readonly mirrors: ReadonlyMap<number, JournalStore>;
  readonly fanout: MirrorFanout;
}

async function resume(rig: MirrorRig): Promise<Reopened> {
  const primary = await JournalStore.open(rig.primaryFile, storeDeps());
  const fanout = new MirrorFanout(primary);
  const mirrors = new Map<number, JournalStore>();
  for (const owner of AGENTS) {
    const file = rig.files.get(owner);
    if (file === undefined) throw new Error(`no file for owner ${owner}`);
    mirrors.set(owner, await JournalStore.open(file, storeDeps()));
  }
  return { primary, mirrors, fanout };
}

async function attachAll(reopened: Reopened): Promise<void> {
  for (const [owner, mirror] of reopened.mirrors) {
    await reopened.fanout.attach(mirror, owner);
  }
}

async function closeAll(reopened: Reopened): Promise<void> {
  await reopened.primary.close();
  for (const mirror of reopened.mirrors.values()) await mirror.close();
}

describe('a compaction keeps the version identity (D-ORCH-6)', () => {
  const directory = useTempDir('journal-compaction-identity-');

  it('keeps the published commitSeq and groupTag', async () => {
    const rig = await rigWithMirrors(directory(), AGENTS);
    await rig.fanout.commit([group('one')]);
    await rig.fanout.commit([group('two')]);
    await rig.fanout.flush();
    const { commitSeq, groupTag } = rig.primary.published ?? {};

    expect(await rig.primary.compact()).toBe('swapped');

    expect(rig.primary.published?.commitSeq).toBe(commitSeq);
    expect(rig.primary.published?.groupTag).toBe(groupTag);
    await rig.closeAll();
    const reopened = await JournalStore.open(rig.primaryFile, storeDeps());
    expect(reopened.published?.commitSeq).toBe(commitSeq);
    expect(reopened.published?.groupTag).toBe(groupTag);
    await reopened.close();
  });

  it('causes no mirror write: two mirrors in sync keep their size after the primary compacts and everything is reopened', async () => {
    const rig = await rigWithMirrors(directory(), AGENTS);
    await rig.fanout.commit([group('one')]);
    await rig.fanout.commit([group('two')]);
    await rig.fanout.syncIdentities();
    await rig.fanout.flush();
    expect(await rig.primary.compact()).toBe('swapped');
    await rig.closeAll();
    const sizes = new Map<number, number>();
    for (const owner of AGENTS) {
      sizes.set(owner, await sizeOf(rig.files.get(owner)));
    }

    const reopened = await resume(rig);
    await attachAll(reopened);

    for (const owner of AGENTS) {
      expect(await sizeOf(rig.files.get(owner))).toBe(sizes.get(owner) ?? -1);
      await expectMirrorEqualsFiltered(
        reopened.primary,
        reopened.mirrors.get(owner) ?? reopened.primary,
        owner,
      );
    }
    await closeAll(reopened);
  });

  it('still resynchronizes a mirror when the compacted primary then loses its newest group', async () => {
    const rig = await rigWithMirrors(directory(), AGENTS);
    await rig.fanout.commit([group('one')]);
    await rig.fanout.commit([group('two')]);
    await rig.fanout.flush();
    expect(await rig.primary.compact()).toBe('swapped');
    const keep = rig.primary.published?.durableEnd ?? 0;
    await rig.fanout.commit([group('three')]);
    await rig.fanout.flush();
    await rig.closeAll();
    await fsp.truncate(rig.primaryFile, keep);

    const reopened = await resume(rig);
    expect(reopened.primary.published?.rows).toBe(6);
    expect(reopened.mirrors.get(A)?.published?.rows).toBe(6);
    await attachAll(reopened);

    expect(reopened.mirrors.get(A)?.published?.rows).toBe(4);
    for (const owner of AGENTS) {
      await expectMirrorEqualsFiltered(
        reopened.primary,
        reopened.mirrors.get(owner) ?? reopened.primary,
        owner,
      );
    }
    await closeAll(reopened);
  });
});
