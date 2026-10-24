/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach } from 'bun:test';
import type { JournalStore } from '../../journalStore.js';
import type { RecordAccess } from '../../recordAccess.js';

export function trackPinnedAccess(): (
  store: JournalStore,
) => Promise<RecordAccess> {
  const reads: Array<Awaited<ReturnType<JournalStore['openRead']>>> = [];
  afterEach(async () => {
    for (const read of reads.splice(0)) await read.close();
  });
  return async (store) => {
    const read = await store.openRead();
    reads.push(read);
    return read.access;
  };
}

export async function withPinnedAccess<T>(
  work: (
    accessOf: (store: JournalStore) => Promise<RecordAccess>,
  ) => Promise<T>,
): Promise<T> {
  const reads: Array<Awaited<ReturnType<JournalStore['openRead']>>> = [];
  try {
    return await work(async (store) => {
      const read = await store.openRead();
      reads.push(read);
      return read.access;
    });
  } finally {
    for (const read of reads) await read.close();
  }
}
