/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { stat, symlink } from 'node:fs/promises';
import { JournalStore } from './journalStore.js';
import { openJournalReadOnly } from './journalReader.js';
import { compactionCandidatePath } from './compaction.js';
import { realFileOperations } from './compactionSwap.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('named journal writer exclusion', () => {
  const directory = useTempDir('journal-writer-exclusion-');

  it('releases ownership when creating or opening the writer fails', async () => {
    const file = join(directory(), 'failure.llxj');
    const deps = storeDeps();
    const failure = new Error('writer open failed');
    const failing = {
      ...deps,
      journal: {
        ...deps.journal,
        open: async (): Promise<never> => {
          throw failure;
        },
      },
    };
    await expect(JournalStore.create(file, failing)).rejects.toBe(failure);
    const first = await JournalStore.create(file, deps);
    await first.close();
    await expect(JournalStore.open(file, failing)).rejects.toBe(failure);
    const second = await JournalStore.open(file, deps);
    await second.close();
  });

  it('recognizes aliases and does not release a later owner when a closed owner closes again', async () => {
    const file = join(directory(), 'aliases.llxj');
    const alias = join(directory(), 'alias.llxj');
    const deps = storeDeps();
    const first = await JournalStore.create(file, deps);
    await symlink(file, alias);
    await expect(JournalStore.open(alias, deps)).rejects.toThrow(
      'already has a writer',
    );
    await expect(JournalStore.create(file, deps)).rejects.toThrow(
      'already has a writer',
    );
    await first.close();
    const second = await JournalStore.open(alias, deps);
    await first.close();
    await expect(JournalStore.open(file, deps)).rejects.toThrow(
      'already has a writer',
    );
    await second.close();
    const third = await JournalStore.open(file, deps);
    await third.close();
  });

  it('refuses a second owner before it can remove an in-progress compaction candidate', async () => {
    const file = join(directory(), 'history.llxj');
    const deps = storeDeps();
    const real = realFileOperations(deps.journal.open);
    const reached = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const store = await JournalStore.create(file, {
      ...deps,
      fileOperations: {
        ...real,
        rename: async (from, to): Promise<void> => {
          reached.resolve();
          await resume.promise;
          await real.rename(from, to);
        },
      },
    });
    await store.commit([{ kind: 'append', rows: [draftRow()] }]);
    const compacting = store.compact();
    await reached.promise;
    try {
      const before = await stat(compactionCandidatePath(file));
      const second = JournalStore.open(file, deps);
      await expect(second).rejects.toThrow('already has a writer');
      await expect(stat(compactionCandidatePath(file))).resolves.toMatchObject({
        size: before.size,
      });
      const reader = await openJournalReadOnly(file);
      expect(reader.trailer?.rootAggregate.rows).toBe(1);
      await reader.close();
    } finally {
      resume.resolve();
      await compacting;
      await store.close();
    }
    const reopened = await JournalStore.open(file, deps);
    expect(reopened.published?.rows).toBe(1);
    await reopened.close();
  });
});
