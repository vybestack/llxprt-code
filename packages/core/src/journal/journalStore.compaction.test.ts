/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  compactionCandidatePath,
  COMPACTION_REARM_BYTES,
} from './compaction.js';
import { realFileOperations, type FileOperations } from './compactionSwap.js';
import { JournalWriterPoisonedError } from './errors.js';
import { decodeJournalHeader } from './fileHeader.js';
import { JournalStore } from './journalStore.js';
import { openJournalReadOnly } from './journalReader.js';
import { compactionCopy } from './versionCopy.js';
import {
  copyDeps,
  growAfterCheckpoint,
  openStore,
  SESSION_STATE,
  setState,
  withoutOffsets,
} from './__tests__/support/copyFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import {
  appendEach,
  draftRow,
  labelsOf,
  scenarioDrafts,
  storeDeps,
} from './__tests__/support/storeFixtures.js';
import { snapshotStore } from './__tests__/support/storeSnapshot.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { trackPinnedAccess } from './__tests__/support/pinnedAccess.js';

const accessOf = trackPinnedAccess();

const MIB = 1024 * 1024;
const IDS = ['a', 'b', 'c', 'd', 'e', 'c1-0', 'c2-0'];

interface Behaviour {
  /** The error the rename throws, if any. */
  renameError?: Error;
  /** The rename waits for this before it runs. */
  holdRename?: Promise<void>;
  /** Opening the journal file itself (not the candidate) fails with this. */
  failOpenOfJournal?: Error;
}

/** Every close, rename and open the swap asks of the file system, in order, with failures on request. */
function swapOperations(
  file: string,
  behaviour: Behaviour,
  platform: NodeJS.Platform = 'win32',
) {
  const calls: string[] = [];
  const real = realFileOperations(testJournalSeams().dependencies.open);
  const ops: FileOperations = {
    platform,
    close: (handle) => {
      calls.push('close');
      return real.close(handle);
    },
    rename: async (from, to) => {
      calls.push('rename');
      await behaviour.holdRename;
      if (behaviour.renameError !== undefined) throw behaviour.renameError;
      await real.rename(from, to);
    },
    open: (target, flags) => {
      calls.push(`open ${path.basename(target)}`);
      if (target === file && behaviour.failOpenOfJournal !== undefined) {
        return Promise.reject(behaviour.failOpenOfJournal);
      }
      return real.open(target, flags);
    },
    syncDirectory: (directory) => real.syncDirectory(directory),
  };
  return { ops, calls };
}

function refusal(code: string): Error {
  return Object.assign(new Error(`${code}: rename refused`), { code });
}

async function fileIdOf(file: string): Promise<string> {
  const handle = await fsp.open(file, 'r');
  try {
    const bytes = new Uint8Array(64);
    await handle.read(bytes, 0, 64, 0);
    return Buffer.from(decodeJournalHeader(bytes).fileId).toString('hex');
  } finally {
    await handle.close();
  }
}

describe('compaction of a live store (design 4.11)', () => {
  const directory = useTempDir('journal-store-compaction-');
  const file = (name: string) => path.join(directory(), name);
  /** What the test policy answers; it honours the re-arm point like the real trigger. */
  let armed = false;
  const policy = (version: { durableEnd: number }, notBefore: number) =>
    armed && version.durableEnd >= notBefore;

  async function session(
    name: string,
    behaviour: Behaviour = {},
  ): Promise<{ store: JournalStore; calls: string[]; file: string }> {
    armed = false;
    const target = file(name);
    const { ops, calls } = swapOperations(target, behaviour);
    const store = await JournalStore.create(
      target,
      storeDeps({ fileOperations: ops, compactionDue: policy }),
    );
    await store.commit(
      SESSION_STATE.map(([key, value]) => setState(key, value)),
    );
    await appendEach(store, scenarioDrafts());
    await growAfterCheckpoint(store, 'c1', 2);
    await growAfterCheckpoint(store, 'c2', 3);
    return { store, calls, file: target };
  }

  it('keeps the history and every live checkpoint version, and the descriptors name the copied trailers', async () => {
    const { store, file: target } = await session('live.llxj');
    const before = withoutOffsets(await snapshotStore(store, IDS));
    const commitSeq = store.published?.commitSeq;
    const oldDescriptors = await Promise.all(
      ['c1', 'c2'].map((id) => store.checkpoint(id)),
    );
    const sizeBefore = (await fsp.stat(target)).size;
    const oldId = await fileIdOf(target);

    expect(await store.compact()).toBe('swapped');

    expect(withoutOffsets(await snapshotStore(store, IDS))).toStrictEqual(
      before,
    );
    expect(store.published?.commitSeq).toBe(commitSeq);
    expect((await fsp.stat(target)).size).toBeLessThan(sizeBefore);
    expect(await fileIdOf(target)).not.toBe(oldId);
    for (const [at, id] of ['c1', 'c2'].entries()) {
      const moved = await store.checkpoint(id);
      const was = oldDescriptors[at];
      expect(moved?.commitSeq).toBe(was?.commitSeq);
      expect(moved?.trailerOffset).not.toBe(was?.trailerOffset);
      const saved = await store.readVersion(moved?.trailerOffset ?? 0);
      expect(saved.commitSeq).toBe(was?.commitSeq ?? -1);
    }
    await store.close();
  });

  it('continues to write and read after the swap, and an independent open sees the group', async () => {
    const { store, file: target } = await session('after.llxj');
    await store.compact();

    await appendEach(store, [draftRow({ text: 'after the swap' })]);
    const rows = (await labelsOf(store)).length;
    const expected = withoutOffsets(await snapshotStore(store, IDS));
    await store.close();
    const reopened = await openStore(target);

    expect((await labelsOf(reopened)).length).toBe(rows);
    expect(withoutOffsets(await snapshotStore(reopened, IDS))).toStrictEqual(
      expected,
    );
    await reopened.close();
  });

  it('compacts by itself after an acked group when the policy says so, once, behind a queue of commits', async () => {
    const { store, calls } = await session('auto.llxj');
    armed = true;

    const first = store.commit([{ kind: 'append', rows: [draftRow()] }]);
    const second = store.commit([{ kind: 'append', rows: [draftRow()] }]);
    await Promise.all([first, second]);
    await store.idle();

    expect(calls.filter((call) => call === 'rename')).toHaveLength(1);
    expect((await labelsOf(store)).length).toBe(6 + 2 + 3 + 2);
    await store.close();
  });

  it('does not compact while a pin is live, and compacts when the last pin is released', async () => {
    const { store, calls } = await session('pinned.llxj');
    armed = true;
    const release = await store.pin();

    await store.commit([{ kind: 'append', rows: [draftRow()] }]);
    await store.idle();
    expect(calls).not.toContain('rename');
    await expect(store.compact()).rejects.toThrow('live pin');

    await release();
    await store.idle();
    expect(calls.filter((call) => call === 'rename')).toHaveLength(1);
    await store.close();
  });

  it('makes a read that starts during the swap wait for it and read the compacted file', async () => {
    let letRenameRun: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      letRenameRun = resolve;
    });
    const { store, calls } = await session('reading.llxj', {
      holdRename: held,
    });
    const expected = await labelsOf(store);

    const compacting = store.compact();
    while (!calls.includes('rename')) await Bun.sleep(1);
    const reading = labelsOf(store);
    await Bun.sleep(20);
    letRenameRun();

    expect(await compacting).toBe('swapped');
    expect(await reading).toStrictEqual(expected);
    await store.close();
  });

  it('runs the real trigger: a 70 MiB row that was popped leaves a file that compacts to a few KiB', async () => {
    const target = file('real.llxj');
    const store = await JournalStore.create(target, storeDeps());
    await store.commit([
      { kind: 'append', rows: [draftRow({ text: 'x'.repeat(70 * MIB) })] },
    ]);
    const [label] = await labelsOf(store);
    expect((await fsp.stat(target)).size).toBeGreaterThan(64 * MIB);
    await store.commit([{ kind: 'pop', cutLabel: label, expectedRemoved: 1 }]);
    await store.idle();

    expect((await fsp.stat(target)).size).toBeLessThan(MIB);
    expect(await labelsOf(store)).toStrictEqual([]);
    await store.close();
  });

  describe('swap state machine', () => {
    it('restores the descriptors when the platform refuses the rename after they were closed, and re-arms the trigger', async () => {
      const {
        store,
        calls,
        file: target,
      } = await session('refused.llxj', {
        renameError: refusal('EPERM'),
      });
      const oldId = await fileIdOf(target);
      const rowsBefore = (await labelsOf(store)).length;

      expect(await store.compact()).toBe('refused');

      const swapCalls = calls.slice(calls.indexOf('close'));
      expect(swapCalls.slice(0, 3)).toStrictEqual([
        'close',
        'rename',
        'open refused.llxj',
      ]);
      await expect(fsp.stat(compactionCandidatePath(target))).rejects.toThrow(
        'ENOENT',
      );
      expect(await fileIdOf(target)).toBe(oldId);
      await appendEach(store, [
        draftRow({ text: 'written after the refusal' }),
      ]);
      const reopened = await openJournalReadOnly(target);
      expect(reopened.trailer?.rootAggregate.rows).toBe(rowsBefore + 1);
      await reopened.close();

      armed = true;
      await store.commit([{ kind: 'append', rows: [draftRow()] }]);
      await store.idle();
      expect(calls.filter((call) => call === 'rename')).toHaveLength(1);
      expect(COMPACTION_REARM_BYTES).toBe(16 * MIB);
      await store.close();
    });

    it('restores the descriptors and rethrows an unexpected error from the rename', async () => {
      const { store, file: target } = await session('eio.llxj', {
        renameError: refusal('EIO'),
      });
      const oldId = await fileIdOf(target);

      await expect(store.compact()).rejects.toThrow('EIO');

      expect(await fileIdOf(target)).toBe(oldId);
      await appendEach(store, [draftRow()]);
      await store.close();
    });

    it('does not take EPERM for a refusal off Windows', async () => {
      armed = false;
      const target = file('posix.llxj');
      const { ops } = swapOperations(
        target,
        { renameError: refusal('EPERM') },
        'linux',
      );
      const store = await JournalStore.create(
        target,
        storeDeps({ fileOperations: ops }),
      );
      await appendEach(store, [draftRow()]);

      await expect(store.compact()).rejects.toThrow('EPERM');

      await appendEach(store, [draftRow()]);
      await store.close();
    });

    it('poisons the writer with both errors when the old file cannot be reopened after a refused rename', async () => {
      const failure = new Error('cannot reopen the old file');
      const { store } = await session('poison-restore.llxj', {
        renameError: refusal('EPERM'),
        failOpenOfJournal: failure,
      });

      const attempt = store.compact();

      await expect(attempt).rejects.toBeInstanceOf(AggregateError);
      await expect(attempt).rejects.toMatchObject({
        errors: [expect.objectContaining({ code: 'EPERM' }), failure],
      });
      await expect(
        store.commit([{ kind: 'append', rows: [draftRow()] }]),
      ).rejects.toBeInstanceOf(JournalWriterPoisonedError);
      await store.close();
    });

    it('poisons the writer when the new file cannot be opened after the rename', async () => {
      const failure = new Error('cannot open the compacted file');
      const { store } = await session('poison-attach.llxj', {
        failOpenOfJournal: failure,
      });

      await expect(store.compact()).rejects.toThrow(
        'cannot open the compacted',
      );

      await expect(
        store.commit([{ kind: 'append', rows: [draftRow()] }]),
      ).rejects.toBeInstanceOf(JournalWriterPoisonedError);
      await store.close();
    });
  });

  describe('crash at each step opens to a valid state, and a stale candidate is removed on open', () => {
    async function closedSession(name: string) {
      const { store, file: target } = await session(name);
      const before = withoutOffsets(await snapshotStore(store, IDS));
      return { store, target, before };
    }

    async function copyBeside(
      store: JournalStore,
      destination: string,
    ): Promise<void> {
      const published = store.published;
      if (published === undefined) throw new Error('nothing is published');
      await compactionCopy(
        await accessOf(store),
        published,
        destination,
        copyDeps(),
      );
    }

    it('before the candidate is complete', async () => {
      const { store, target, before } = await closedSession('crash-a.llxj');
      const candidate = compactionCandidatePath(target);
      await copyBeside(store, candidate);
      await store.close();
      const { size } = await fsp.stat(candidate);
      await fsp.truncate(candidate, Math.floor(size / 2));

      const reopened = await openStore(target);

      await expect(fsp.stat(candidate)).rejects.toThrow('ENOENT');
      expect(withoutOffsets(await snapshotStore(reopened, IDS))).toStrictEqual(
        before,
      );
      await reopened.close();
    });

    it('after the candidate is complete and before the rename', async () => {
      const { store, target, before } = await closedSession('crash-b.llxj');
      const candidate = compactionCandidatePath(target);
      await copyBeside(store, candidate);
      await store.close();

      const reopened = await openStore(target);

      await expect(fsp.stat(candidate)).rejects.toThrow('ENOENT');
      expect(withoutOffsets(await snapshotStore(reopened, IDS))).toStrictEqual(
        before,
      );
      await reopened.close();
    });

    it('after the rename', async () => {
      const { store, target, before } = await closedSession('crash-c.llxj');
      const candidate = compactionCandidatePath(target);
      await copyBeside(store, candidate);
      await store.close();
      await fsp.rename(candidate, target);

      const reopened = await openStore(target);

      expect(withoutOffsets(await snapshotStore(reopened, IDS))).toStrictEqual(
        before,
      );
      await reopened.close();
    });
  });
});
