/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { cloneCheckpoint, compactionCopy } from './versionTransfer.js';
import { JournalStore } from './journalStore.js';
import { MUTATION } from './recordKinds.js';
import { copyDeps, openStore } from './__tests__/support/copyFixtures.js';
import {
  appendEach,
  draftRow,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { OffsetAudit } from './__tests__/support/offsetAudit.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { trackPinnedAccess } from './__tests__/support/pinnedAccess.js';

const accessOf = trackPinnedAccess();

function published(store: JournalStore) {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

async function checkpointIds(store: JournalStore): Promise<string[]> {
  const ids: string[] = [];
  for await (const listed of store.checkpoints()) ids.push(listed.id);
  return ids.sort();
}

describe('checkpoint delete (design 4.9, 4.11)', () => {
  const directory = useTempDir('journal-ckpt-delete-');
  const file = (name: string) => path.join(directory(), name);

  async function withCheckpoints(name: string): Promise<JournalStore> {
    const store = await JournalStore.create(file(name), storeDeps());
    await appendEach(store, [draftRow(), draftRow(), draftRow()]);
    await store.commit([
      { kind: 'checkpoint', id: 'a', name: 'first', createdAtMs: 1 },
    ]);
    await appendEach(store, [draftRow()]);
    await store.commit([
      { kind: 'checkpoint', id: 'b', name: 'second', createdAtMs: 2 },
    ]);
    return store;
  }

  it('is a state-only group that leaves the rows alone and gives the version back', async () => {
    const store = await withCheckpoints('delete.llxj');
    const before = published(store);
    const second = JSON.parse(
      new TextDecoder().decode(await store.getState('ckpt:b')),
    ) as { liveBytes: number };

    await store.commit([{ kind: 'deleteCheckpoint', id: 'b' }]);

    const after = published(store);
    expect(after.mutation).toBe(MUTATION.state);
    expect(after.roots.rowRoot).toBe(before.roots.rowRoot);
    expect(after.roots.idRoot).toBe(before.roots.idRoot);
    expect(after.rows).toBe(before.rows);
    expect(after.ckptBytes).toBe(before.ckptBytes - second.liveBytes);
    expect(await checkpointIds(store)).toStrictEqual(['a']);
    expect(await store.checkpoint('b')).toBeUndefined();
    expect((await store.checkpoint('a'))?.name).toBe('first');
    await store.close();
  });

  it('stays deleted after the file is reopened', async () => {
    const store = await withCheckpoints('reopen.llxj');
    await store.commit([{ kind: 'deleteCheckpoint', id: 'a' }]);
    await store.close();
    const reopened = await openStore(file('reopen.llxj'));
    expect(await checkpointIds(reopened)).toStrictEqual(['b']);
    await reopened.close();
  });

  it('refuses a checkpoint that does not exist or is already deleted, and writes nothing', async () => {
    const store = await withCheckpoints('refuse.llxj');
    await store.commit([{ kind: 'deleteCheckpoint', id: 'a' }]);
    const before = published(store);
    await expect(
      store.commit([{ kind: 'deleteCheckpoint', id: 'a' }]),
    ).rejects.toThrow(/no checkpoint "a"/);
    await expect(
      store.commit([{ kind: 'deleteCheckpoint', id: 'nope' }]),
    ).rejects.toThrow(/no checkpoint "nope"/);
    expect(published(store).commitSeq).toBe(before.commitSeq);
    await store.close();
  });

  it('cannot be restored once deleted, and the other checkpoint still can', async () => {
    const store = await withCheckpoints('restore.llxj');
    await store.commit([{ kind: 'deleteCheckpoint', id: 'a' }]);
    const deps = copyDeps();
    await expect(
      cloneCheckpoint(
        await accessOf(store),
        published(store),
        'a',
        file('child-a.llxj'),
        deps,
      ),
    ).rejects.toThrow(/no checkpoint "a"/);
    const child = await cloneCheckpoint(
      await accessOf(store),
      published(store),
      'b',
      file('child-b.llxj'),
      deps,
    );
    const opened = await openStore(child.path);
    expect(published(opened).rows).toBe(4);
    await opened.close();
    await store.close();
  });

  it('is dropped by a compaction copy: the version is not retained and the current map has no entry', async () => {
    const store = await withCheckpoints('compact.llxj');
    await store.commit([{ kind: 'deleteCheckpoint', id: 'a' }]);
    const compacted = await compactionCopy(
      await accessOf(store),
      published(store),
      file('compacted.llxj'),
      copyDeps(),
    );
    expect(compacted.versions).toHaveLength(2);
    const reopened = await openStore(compacted.path);
    expect(await checkpointIds(reopened)).toStrictEqual(['b']);
    expect(await reopened.getState('ckpt:a')).toBeUndefined();
    expect(published(reopened).ckptBytes).toBe(published(store).ckptBytes);
    await new OffsetAudit(await accessOf(reopened)).walkVersion(
      published(reopened),
    );
    await reopened.close();
    await store.close();
  });
});
