/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { fstatSync } from 'node:fs';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { releaseRead } from './pinLease.js';
import { JournalDumpSnapshot } from '../services/history/journalDumpSnapshot.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { withVersionSnapshot } from '../services/history/journalScalars.js';
import { rejectedValue } from '../services/history/chronology-rollback-test-helpers.js';
import { RowOwnership } from '../recording/rowOwnership.js';
import { createRowCounters } from '../recording/journalCounters.js';

class FailingReleaseOwnership extends RowOwnership {
  constructor(private readonly failure: Error) {
    super();
  }

  override release(row: object): void {
    super.release(row);
    throw this.failure;
  }
}

describe('retired reader cross-cleanup error identity', () => {
  const directory = useTempDir('journal-reader-cleanup-');

  async function opened(cleanup: Error): Promise<{
    store: JournalStore;
    fd: number;
    failReads: (failure: Error) => void;
  }> {
    const deps = storeDeps();
    let fd = -1;
    let readFailure: Error | undefined;
    const store = await JournalStore.create(join(directory(), 'history.llxj'), {
      ...deps,
      journal: {
        ...deps.journal,
        open: async (file, flags) => {
          const handle = await deps.journal.open(file, flags);
          fd = handle.fd;
          return {
            ...handle,
            read: async (buffer, offset, length, position) => {
              if (readFailure !== undefined) throw readFailure;
              return handle.read(buffer, offset, length, position);
            },
            close: async () => {
              await handle.close();
              throw cleanup;
            },
          };
        },
      },
    });
    await store.commit([
      {
        kind: 'append',
        rows: [
          encodeContentRow(
            { speaker: 'human', blocks: [{ type: 'text', text: 'kept' }] },
            { owner: 0 },
          ),
        ],
      },
    ]);
    return {
      store,
      fd,
      failReads: (failure) => {
        readFailure = failure;
      },
    };
  }

  it('keeps the original consumer error before the original dump descriptor failure', async () => {
    const primary = new Error('consumer failed');
    const cleanup = new Error('descriptor release failed');
    const { store, fd } = await opened(cleanup);
    const dump = new JournalDumpSnapshot(await store.snapshot());
    await store.close();
    const error = await rejectedValue(
      Promise.resolve().then(() => releaseRead(dump, { error: primary })),
    );
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw error;
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toBe(primary);
    expect(error.errors[1]).toBe(cleanup);
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });

  it('preserves readAt failure identity before final descriptor release failure', async () => {
    const primary = new Error('positional read failed');
    const cleanup = new Error('descriptor release failed');
    const { store, fd, failReads } = await opened(cleanup);
    const snapshot = await store.snapshot();
    const entry = await snapshot.entryAt(0);
    await store.close();
    failReads(primary);
    const error = await rejectedValue(
      withVersionSnapshot(snapshot, async (read) => {
        await read.readRow(entry);
      }),
    );
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw error;
    expect(error.errors).toHaveLength(2);
    expect(error.errors[0]).toBe(primary);
    expect(error.errors[1]).toBe(cleanup);
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });

  it('still closes the descriptor when suspended dump reader cleanup fails independently', async () => {
    const primary = new Error('decoded row release failed');
    const cleanup = new Error('descriptor release failed');
    const { store, fd } = await opened(cleanup);
    const ownership = new FailingReleaseOwnership(primary);
    const { counters } = createRowCounters();
    const dump = new JournalDumpSnapshot(await store.snapshot(), undefined, {
      ...counters,
      ownership,
    });
    expect((await dump.rows().next()).done).toBe(false);
    expect(ownership.snapshot().liveRows).toBe(1);
    await store.close();
    const error = await rejectedValue(dump.close());
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError)) throw error;
    expect(error.errors).toHaveLength(2);
    const readerCleanup: unknown = error.errors[0];
    expect(readerCleanup).toBeInstanceOf(AggregateError);
    if (!(readerCleanup instanceof AggregateError)) throw readerCleanup;
    expect(readerCleanup.errors).toHaveLength(1);
    expect(readerCleanup.errors[0]).toBe(primary);
    expect(error.errors[1]).toBe(cleanup);
    expect(ownership.snapshot().liveRows).toBe(0);
    expect(() => fstatSync(fd)).toThrow(/EBADF/);
  });
});
