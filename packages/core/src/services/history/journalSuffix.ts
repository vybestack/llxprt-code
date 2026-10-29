/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { HistorySuffixQuery } from './historyJournalRows.js';
import { decodeStoredRow } from './journalRowCodec.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import { countDecodedRow } from './journalRowCounters.js';

/** The first of the last `count` rows; a count that is not a positive number keeps the whole history. */
function recentStart(length: number, count: number): number {
  const start = -Math.trunc(count);
  if (Number.isNaN(start)) return 0;
  return start < 0 ? Math.max(length + start, 0) : Math.min(start, length);
}

async function tokenSuffixStart(
  snapshot: VersionSnapshot,
  query: Extract<HistorySuffixQuery, { kind: 'tokens' }>,
  signal: AbortSignal | undefined,
  resumeBoundary: bigint | undefined,
  counters: JournalReadCounters | undefined,
): Promise<number> {
  let start = snapshot.rows;
  let total = 0;
  while (start > 0) {
    signal?.throwIfAborted();
    const entry = await snapshot.entryAt(start - 1);
    const row = decodeStoredRow(await snapshot.readRow(entry), resumeBoundary);
    const release = countDecodedRow(row, counters);
    let tokens: number;
    try {
      tokens = query.countTokens(row);
    } finally {
      release();
    }
    if (!(total + tokens <= query.maxTokens)) break;
    total += tokens;
    start -= 1;
  }
  return start;
}

/** The position of the first row a suffix query selects. */
export async function suffixStart(
  snapshot: VersionSnapshot,
  query: HistorySuffixQuery | undefined,
  signal: AbortSignal | undefined,
  resumeBoundary?: bigint,
  counters?: JournalReadCounters,
): Promise<number> {
  if (query === undefined) return 0;
  if (query.kind === 'recent') return recentStart(snapshot.rows, query.count);
  return tokenSuffixStart(snapshot, query, signal, resumeBoundary, counters);
}
