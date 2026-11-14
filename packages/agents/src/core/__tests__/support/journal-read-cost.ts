/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';

export interface JournalReadCost {
  readonly walks: number;
  readonly entries: number;
  readonly rows: number;
}

export async function measureJournalReadCost<T>(
  execute: () => Promise<T>,
): Promise<{ value: T; cost: JournalReadCost }> {
  const entries = VersionSnapshot.prototype.entries;
  const readRow = VersionSnapshot.prototype.readRow;
  let walks = 0;
  let visited = 0;
  let rows = 0;
  VersionSnapshot.prototype.entries = async function* (
    from = 0,
  ): ReturnType<VersionSnapshot['entries']> {
    walks++;
    for await (const entry of entries.call(this, from)) {
      visited++;
      yield entry;
    }
  };
  VersionSnapshot.prototype.readRow = function (
    entry,
  ): ReturnType<VersionSnapshot['readRow']> {
    rows++;
    return readRow.call(this, entry);
  };
  try {
    const value = await execute();
    return { value, cost: { walks, entries: visited, rows } };
  } finally {
    VersionSnapshot.prototype.entries = entries;
    VersionSnapshot.prototype.readRow = readRow;
  }
}
