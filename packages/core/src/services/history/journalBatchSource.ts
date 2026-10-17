/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';
import { decodeStoredRow } from './journalRowCodec.js';

/**
 * The last `count` rows of `snapshot` as a batch event source. The snapshot
 * fixes the version, so the rows a listener reads are the committed ones
 * whatever is published afterwards; each pass decodes one row at a time from
 * the file and keeps none.
 */
export function committedBatchSource(
  snapshot: VersionSnapshot,
  count: number,
): HistoryBatchRowSource {
  if (count > snapshot.rows) {
    throw new Error(
      `A batch of ${count} rows is larger than the version it was published in (${snapshot.rows} rows)`,
    );
  }
  const start = snapshot.rows - count;
  return {
    length: count,
    async *rows() {
      for await (const entry of snapshot.entries(start)) {
        yield decodeStoredRow(await snapshot.readRow(entry));
      }
    },
  };
}
