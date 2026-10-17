/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalStore } from '../../journalStore.js';
import type { RecordAccess } from '../../recordAccess.js';

/**
 * The record reads of the version `store` has published, for a test that
 * copies or audits it. The read stays open until the store is closed at the
 * end of the test, which is what these tests want: they never compact the
 * store they read.
 */
export async function accessOf(store: JournalStore): Promise<RecordAccess> {
  return (await store.openRead()).access;
}
