/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import { decodeStoredRow } from './journalRowCodec.js';
import { countDecodedRow } from './journalRowCounters.js';

export type CommittedBatchRowSource = HistoryBatchRowSource;

/**
 * The last `count` rows of `snapshot` as a batch event source. The snapshot
 * fixes the version, so the rows a listener reads are the committed ones
 * whatever is published afterwards; each pass decodes one row at a time from
 * the file and keeps none. The source owns the snapshot: it closes it once it
 * is retired and no pass is running, so a listener's reads never outlive the
 * pin that keeps the version's offsets valid.
 */
export function committedBatchSource(
  snapshot: VersionSnapshot,
  count: number,
  resumeBoundary?: bigint,
  counters?: JournalReadCounters,
): CommittedBatchRowSource {
  if (count > snapshot.rows) {
    throw new Error(
      `A batch of ${count} rows is larger than the version it was published in (${snapshot.rows} rows)`,
    );
  }
  const start = snapshot.rows - count;
  let retired = false;
  let passes = 0;
  let closed = false;
  const closeWhenIdle = (): void => {
    if (retired && passes === 0 && !closed) {
      closed = true;
      snapshot.close();
    }
  };
  return {
    length: count,
    async *rows() {
      if (retired) {
        throw new Error(
          'The batch was retired; its rows can no longer be read',
        );
      }
      passes += 1;
      try {
        for await (const entry of snapshot.entries(start)) {
          const row = decodeStoredRow(
            await snapshot.readRow(entry),
            resumeBoundary,
          );
          const release = countDecodedRow(row, counters);
          try {
            yield row;
          } finally {
            release();
          }
        }
      } finally {
        passes -= 1;
        closeWhenIdle();
      }
    },
    retire() {
      retired = true;
      closeWhenIdle();
    },
  };
}
