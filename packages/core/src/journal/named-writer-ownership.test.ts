/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NamedWriterOwnership } from './named-writer-ownership.js';
import { JournalStore } from './journalStore.js';
import { storeDeps } from './__tests__/support/storeFixtures.js';

describe('named journal writer ownership', () => {
  it('excludes independent opens and realpath aliases until the writer closes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'named-writer-owner-'));
    const ownership = new NamedWriterOwnership();
    const file = join(directory, 'history.llxj');
    const alias = join(directory, 'alias.llxj');
    const first = await JournalStore.create(file, storeDeps(), ownership);
    try {
      await symlink(file, alias);
      await expect(
        JournalStore.open(file, storeDeps(), ownership),
      ).rejects.toThrow('already has a writer');
      await expect(
        JournalStore.open(alias, storeDeps(), ownership),
      ).rejects.toThrow('already has a writer');
      await first.close();
      const reopened = await JournalStore.open(alias, storeDeps(), ownership);
      await reopened.close();
    } finally {
      await first.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('releases failed create and open acquisitions without releasing another owner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'named-writer-owner-'));
    const ownership = new NamedWriterOwnership();
    const file = join(directory, 'history.llxj');
    try {
      const first = await JournalStore.create(file, storeDeps(), ownership);
      await first.close();
      await expect(
        JournalStore.create(file, storeDeps(), ownership),
      ).rejects.toThrow('EEXIST');
      const reopened = await JournalStore.open(file, storeDeps(), ownership);
      await reopened.close();
      const release = await ownership.retain(file, false);
      release();
      const releaseSecond = await ownership.retain(file, false);
      release();
      await expect(ownership.retain(file, false)).rejects.toThrow(
        'already has a writer',
      );
      releaseSecond();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
