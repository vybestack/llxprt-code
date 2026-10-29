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

/** Rows of A, of B and of nobody, so every group concerns both mirrors. */
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

function endOf(store: JournalStore): number {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version.durableEnd;
}

interface Reopened {
  readonly primary: JournalStore;
  readonly mirrors: ReadonlyMap<number, JournalStore>;
  readonly fanout: MirrorFanout;
}

/** Opens the files again and binds the mirrors the way a resume does. */
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

async function attachAll(reopened: Reopened): Promise<Map<number, number>> {
  const written = new Map<number, number>();
  for (const [owner, mirror] of reopened.mirrors) {
    const before = mirror.published?.commitSeq ?? 0;
    await reopened.fanout.attach(mirror, owner);
    written.set(owner, (mirror.published?.commitSeq ?? 0) - before);
  }
  return written;
}

async function expectEqual(reopened: Reopened): Promise<void> {
  for (const [owner, mirror] of reopened.mirrors) {
    await expectMirrorEqualsFiltered(reopened.primary, mirror, owner);
  }
}

async function closeAll(reopened: Reopened): Promise<void> {
  await reopened.primary.close();
  for (const mirror of reopened.mirrors.values()) await mirror.close();
}

describe('mirror recovery (design 5.2 and 13.6)', () => {
  const directory = useTempDir('journal-mirror-recovery-');

  it('a mirror that is ahead of the primary (the primary lost its newest group) is resynchronized', async () => {
    const rig = await rigWithMirrors(directory(), AGENTS);
    await rig.fanout.commit([group('one')]);
    await rig.fanout.commit([group('two')]);
    const keep = endOf(rig.primary);
    await rig.fanout.commit([group('three')]);
    await rig.fanout.flush();
    await rig.closeAll();
    await fsp.truncate(rig.primaryFile, keep);

    const reopened = await resume(rig);
    expect(reopened.primary.published?.rows).toBe(6);
    expect(reopened.mirrors.get(A)?.published?.rows).toBe(6);
    const written = await attachAll(reopened);
    expect([...written.values()]).toStrictEqual([1, 1]);
    await expectEqual(reopened);
    expect(reopened.mirrors.get(A)?.published?.rows).toBe(4);
    await closeAll(reopened);
  });

  it('a mirror that is behind the primary (it lost its newest group) is resynchronized', async () => {
    const rig = await rigWithMirrors(directory(), AGENTS);
    await rig.fanout.commit([group('one')]);
    await rig.fanout.commit([group('two')]);
    await rig.fanout.flush();
    const keep = new Map(
      [...rig.mirrors].map(([owner, mirror]) => [owner, endOf(mirror)]),
    );
    await rig.fanout.commit([group('three')]);
    await rig.fanout.flush();
    await rig.closeAll();
    for (const [owner, end] of keep) {
      const file = rig.files.get(owner);
      if (file === undefined) throw new Error('no file');
      await fsp.truncate(file, end);
    }

    const reopened = await resume(rig);
    expect(reopened.mirrors.get(A)?.published?.rows).toBe(4);
    const written = await attachAll(reopened);
    expect([...written.values()]).toStrictEqual([1, 1]);
    await expectEqual(reopened);
    expect(reopened.mirrors.get(A)?.published?.rows).toBe(6);
    await closeAll(reopened);
  });

  it('a primary that lost its newest group and wrote another reuses the commitSeq, and the mirror that applied the lost group is still resynchronized', async () => {
    const rig = await rigWithMirrors(directory(), AGENTS);
    await rig.fanout.commit([group('one')]);
    await rig.fanout.commit([group('two')]);
    const keep = endOf(rig.primary);
    await rig.fanout.commit([group('lost')]);
    await rig.fanout.flush();
    const lostSeq = rig.primary.published?.commitSeq;
    const lostTag = rig.primary.published?.groupTag;
    await rig.closeAll();
    await fsp.truncate(rig.primaryFile, keep);

    // The primary, opened alone, writes a different third group.
    const alone = await JournalStore.open(rig.primaryFile, storeDeps());
    await alone.commit([group('replacement')]);
    expect(alone.published?.commitSeq).toBe(lostSeq);
    expect(alone.published?.groupTag).not.toBe(lostTag);
    await alone.close();

    const reopened = await resume(rig);
    const written = await attachAll(reopened);
    expect([...written.values()]).toStrictEqual([1, 1]);
    await expectEqual(reopened);
    const text = new TextDecoder();
    const mirror = reopened.mirrors.get(A);
    if (mirror === undefined) throw new Error('no mirror');
    const texts: string[] = [];
    for await (const entry of mirror.rows()) {
      texts.push(text.decode((await mirror.readRow(entry)).blocks[0]));
    }
    expect(texts).toContain('replacement a');
    expect(texts).not.toContain('lost a');
    await closeAll(reopened);
  });

  it('a mirror in sync with the primary writes nothing when it is bound again', async () => {
    const rig = await rigWithMirrors(directory(), AGENTS);
    await rig.fanout.commit([group('one')]);
    await rig.fanout.commit([group('two')]);
    await rig.fanout.syncIdentities();
    await rig.closeAll();
    const sizes = new Map<number, number>();
    for (const [owner, file] of rig.files) {
      sizes.set(owner, (await fsp.stat(file)).size);
    }

    const reopened = await resume(rig);
    const written = await attachAll(reopened);
    expect([...written.values()]).toStrictEqual([0, 0]);
    for (const [owner, file] of rig.files) {
      expect((await fsp.stat(file)).size).toBe(sizes.get(owner) ?? -1);
    }
    await expectEqual(reopened);
    await closeAll(reopened);
  });

  it("a group that none of a mirror's rows concern writes nothing to it, and a clean shutdown records the primary version in one small group", async () => {
    const rig = await rigWithMirrors(directory(), AGENTS);
    await rig.fanout.commit([group('one')]);
    await rig.fanout.flush();
    const sizeBefore = (await fsp.stat(rig.files.get(B) ?? '')).size;
    const seqBefore = rig.mirrors.get(B)?.published?.commitSeq;
    await rig.fanout.commit([
      { kind: 'append', rows: [draftRow({ owner: A, text: 'only a' })] },
    ]);
    await rig.fanout.flush();
    expect((await fsp.stat(rig.files.get(B) ?? '')).size).toBe(sizeBefore);
    expect(rig.mirrors.get(B)?.published?.commitSeq).toBe(seqBefore);

    await rig.fanout.syncIdentities();
    expect(rig.mirrors.get(B)?.published?.commitSeq).toBe((seqBefore ?? 0) + 1);
    expect(rig.mirrors.get(B)?.published?.rows).toBe(2);
    await rig.closeAll();
  });
});
