/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { describe, expect, it } from 'bun:test';
import { realFileOperations, type FileOperations } from './compactionSwap.js';
import { JournalStore } from './journalStore.js';
import { openUnlinkedFile } from './unlinkedFile.js';
import {
  growAfterCheckpoint,
  SESSION_STATE,
  setState,
  withoutOffsets,
} from './__tests__/support/copyFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import {
  appendEach,
  scenarioDrafts,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { snapshotStore } from './__tests__/support/storeSnapshot.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const IDS = ['a', 'b', 'c', 'd', 'e', 'c1-0'];

/** A store whose file has no name, so a compaction has no path to copy into or rename over. */
describe('compaction of a store whose file has no name (design 4.11, 4.12)', () => {
  const directory = useTempDir('journal-unlinked-compaction-');

  async function unlinkedStore(onClose: () => void): Promise<JournalStore> {
    const seams = testJournalSeams();
    const real = realFileOperations(seams.dependencies.open);
    const fileOperations: FileOperations = {
      ...real,
      close: (handle) => {
        onClose();
        return real.close(handle);
      },
    };
    const base = storeDeps({
      seams,
      fileOperations,
      compactionDue: () => false,
    });
    return JournalStore.createUnlinked({
      ...base,
      journal: {
        ...base.journal,
        open: () => openUnlinkedFile({ directory: directory() }),
      },
    });
  }

  it('swaps in a second nameless file, keeps every version, and leaves nothing on disk', async () => {
    let closed = 0;
    const store = await unlinkedStore(() => {
      closed += 1;
    });
    await store.commit(
      SESSION_STATE.map(([key, value]) => setState(key, value)),
    );
    await appendEach(store, scenarioDrafts());
    await growAfterCheckpoint(store, 'c1', 2);
    const before = withoutOffsets(await snapshotStore(store, IDS));
    const commitSeq = store.published?.commitSeq ?? 0;

    expect(await store.compact()).toBe('swapped');

    expect(closed).toBe(1);
    expect(withoutOffsets(await snapshotStore(store, IDS))).toStrictEqual(
      before,
    );
    expect(store.published?.commitSeq).toBe(commitSeq);
    expect(await fsp.readdir(directory())).toStrictEqual([]);
    expect(fs.existsSync('(unlinked journal).compact')).toBe(false);

    await appendEach(store, scenarioDrafts().slice(0, 1));
    expect(store.published?.commitSeq).toBe(commitSeq + 1);
    await store.close();
  });
});
