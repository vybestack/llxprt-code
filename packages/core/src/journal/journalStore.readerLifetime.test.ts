/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { fstatSync } from 'node:fs';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import {
  testJournalSeams,
  type Failures,
} from './__tests__/support/journalFixtures.js';
import { MirrorFanout } from './mirrorFanout.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import {
  withVersionSnapshot,
  streamSnapshotRows,
} from '../services/history/journalScalars.js';
import { committedBatchSource } from '../services/history/journalBatchSource.js';
import { JournalDumpSnapshot } from '../services/history/journalDumpSnapshot.js';

describe('journal reader ownership across writer retirement', () => {
  const directory = useTempDir('journal-reader-lifetime-');

  async function opened(
    closeFailure?: Error,
  ): Promise<{ store: JournalStore; fd: number; arm: () => void }> {
    const seams = testJournalSeams();
    let fd = -1;
    let armed = false;
    const deps = storeDeps({ seams, compactionDue: () => armed });
    const store = await JournalStore.create(join(directory(), 'history.llxj'), {
      ...deps,
      journal: {
        ...deps.journal,
        open: async (file, flags) => {
          const handle = await deps.journal.open(file, flags);
          fd = handle.fd;
          return {
            ...handle,
            close: async () => {
              await handle.close();
              if (closeFailure !== undefined) throw closeFailure;
            },
          };
        },
      },
    });
    await store.commit([
      {
        kind: 'append',
        rows: [draftRow({ text: 'first' }), draftRow({ text: 'second' })],
      },
    ]);
    return {
      store,
      fd,
      arm: () => {
        armed = true;
      },
    };
  }

  it('retires writes without waiting for readers and closes the descriptor at the final held pin', async () => {
    const { store, fd, arm } = await opened();
    const snapshot = await store.snapshot();
    const release = snapshot.hold();
    arm();
    await store.commit([
      { kind: 'append', rows: [draftRow({ text: 'later' })] },
    ]);
    await store.close();
    await expect(store.commit([{ kind: 'clear' }])).rejects.toThrow('closed');
    await expect(store.openRead()).rejects.toThrow('closed');
    expect(snapshot.rows).toBe(2);
    expect(
      (await snapshot.readRow(await snapshot.entryAt(1))).blocks[0],
    ).toStrictEqual(new TextEncoder().encode('second'));
    await snapshot.close();
    expect(fstatSync(fd).size).toBeGreaterThan(0);
    await release();
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
    await store.idle();
    expect(() => release()).toThrow('released twice');
  });

  for (const kind of ['batch', 'dump'] as const) {
    it(`reports retired ${kind} descriptor release failure after closing the file`, async () => {
      const failure = new Error(`${kind} descriptor close failed`);
      const { store, fd } = await opened(failure);
      const snapshot = await store.snapshot();
      const release =
        kind === 'batch'
          ? () => committedBatchSource(snapshot, snapshot.rows).retire()
          : () => new JournalDumpSnapshot(snapshot).close();
      await store.close();
      await expect(Promise.resolve(release())).rejects.toBe(failure);
      expect(() => fstatSync(fd)).toThrow(/EBADF/);
    });
  }

  it('reports a fanout-held reader close failure through flush after all mirrors settle', async () => {
    const failure = new Error('fanout reader descriptor close failed');
    const { store, fd } = await opened(failure);
    const failures: Failures = {};
    const seams = testJournalSeams(failures);
    const mirror = await JournalStore.create(
      join(directory(), 'mirror.llxj'),
      storeDeps({ seams }),
    );
    const fanout = new MirrorFanout(store);
    try {
      await fanout.attach(mirror, 0);
      failures.gateWriteAt = seams.events.filter(
        (event) => event.type === 'write',
      ).length;
      await fanout.commit([
        { kind: 'append', rows: [draftRow({ text: 'fanout' })] },
      ]);
      await store.close();
      expect(fstatSync(fd).size).toBeGreaterThan(0);
      seams.release();
      await expect(fanout.flush()).rejects.toBe(failure);
      expect(mirror.published?.rows).toBe(3);
      expect(() => fstatSync(fd)).toThrow(/EBADF/);
    } finally {
      seams.release();
      await mirror.close();
    }
  });

  it('closes a reader-free journal before returning', async () => {
    const { store, fd } = await opened();
    await store.close();
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });

  it('keeps an abort reason before a deferred descriptor-close failure', async () => {
    const reason = new Error('cancel retired reader');
    const cleanup = new Error('cancelled reader close failed');
    const { store, fd } = await opened(cleanup);
    const snapshot = await store.snapshot();
    const abort = new AbortController();
    abort.abort(reason);
    await store.close();
    const reader = streamSnapshotRows(
      snapshot,
      undefined,
      undefined,
      undefined,
      abort.signal,
    );
    await expect(reader.next()).rejects.toMatchObject({
      errors: [reason, cleanup],
    });
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });

  it('joins an admitted checkpoint deletion before closing while rejecting later work', async () => {
    const { store, fd } = await opened();
    await store.commit([
      { kind: 'checkpoint', id: 'saved', name: 'saved', createdAtMs: 1 },
    ]);
    const deletion = store.commit([{ kind: 'deleteCheckpoint', id: 'saved' }]);
    const closure = store.close();
    await expect(deletion).resolves.toHaveProperty('commitSeq', 3);
    await closure;
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });

  it('closes immediately with no readers and preserves the original close failure', async () => {
    const failure = new Error('descriptor close failed');
    const { store, fd } = await opened(failure);
    await expect(store.close()).rejects.toBe(failure);
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });

  it('reports deferred descriptor close failure to the final reader release', async () => {
    const failure = new Error('retired descriptor close failed');
    const { store, fd } = await opened(failure);
    const read = await store.openRead();
    const other = await store.openRead();
    await store.close();
    await read.close();
    expect(fstatSync(fd).size).toBeGreaterThan(0);
    await expect(Promise.resolve(other.close())).rejects.toBe(failure);
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });

  it('keeps callback and descriptor-close failures in their original order', async () => {
    const primary = new Error('reader callback failed');
    const cleanup = new Error('reader descriptor close failed');
    const { store, fd } = await opened(cleanup);
    const snapshot = await store.snapshot();
    const operation = withVersionSnapshot(snapshot, async () => {
      await store.close();
      throw primary;
    });
    await expect(operation).rejects.toMatchObject({
      errors: [primary, cleanup],
    });
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });

  it('preserves the abort reason when a retired snapshot releases its descriptor', async () => {
    const { store, fd } = await opened();
    const snapshot = await store.snapshot();
    const abort = new AbortController();
    const reason = new Error('cancel reader');
    abort.abort(reason);
    await store.close();
    const reader = streamSnapshotRows(
      snapshot,
      undefined,
      undefined,
      undefined,
      abort.signal,
    );
    await expect(reader.next()).rejects.toBe(reason);
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });
});
