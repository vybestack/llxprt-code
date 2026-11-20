/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryStorePort } from '../../historyStorePort.js';

/** The named file of a store a test opened on a path; a store without one is a broken fixture. */
export function journalPathOf(
  store: Pick<HistoryStorePort, 'journalPath'>,
): string {
  const path = store.journalPath();
  if (path === null) throw new Error('The store has no named journal file');
  return path;
}
