/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { HistoryRowOrigins } from './historyRowOrigins.js';
import type { IContent } from './IContent.js';
import { decodeStoredRow, UNOWNED_ROW } from './journalRowCodec.js';

/**
 * The rows of `snapshot` in order, one decoded row at a time from the file.
 * Row owners are S06: a row with an owner cannot be carried into a candidate
 * yet, so it is refused instead of read as unowned.
 */
export async function* snapshotRows(
  snapshot: VersionSnapshot,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  for await (const entry of snapshot.entries()) {
    signal?.throwIfAborted();
    if (entry.owner !== UNOWNED_ROW) {
      throw new Error(
        'not implemented: S06 (owned rows in a detached capture)',
      );
    }
    yield sanitizeProviderContentForSerialization(
      decodeStoredRow(await snapshot.readRow(entry)),
    );
  }
}

/** Copies the rows of `snapshot` into `previous`, one row at a time from the file. */
export async function captureDetachedRows(
  snapshot: VersionSnapshot,
  previous: DetachedHistoryJournal,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  for await (const row of snapshotRows(snapshot, signal)) previous.append(row);
  previous.settle();
  previous.adoptOrigins(
    HistoryRowOrigins.capture({
      length: snapshot.rows,
      originAt: () => undefined,
    }),
  );
  if (previous.origins.length !== previous.length) {
    throw new Error('History changed while its rows were captured');
  }
  signal?.throwIfAborted();
}
