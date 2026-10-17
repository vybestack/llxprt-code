/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import type { IContent } from './IContent.js';
import { decodeStoredRow } from './journalRowCodec.js';

/**
 * The owner id each row handed out by {@link snapshotRows} had in the
 * snapshot, keyed by the row object. A transform that carries a row over by
 * passing the same object back to the sink keeps its owner; a row the
 * transform builds has no entry and is written unowned. Weak, so a tag never
 * keeps a row alive.
 */
export type RowOwnerTags = WeakMap<IContent, number>;

/**
 * The rows of `snapshot` in order, one decoded row at a time from the file.
 * When `tags` is given each row's owner id is recorded against the row.
 */
export async function* snapshotRows(
  snapshot: VersionSnapshot,
  signal?: AbortSignal,
  tags?: RowOwnerTags,
): AsyncGenerator<IContent, void, unknown> {
  for await (const entry of snapshot.entries()) {
    signal?.throwIfAborted();
    const row = sanitizeProviderContentForSerialization(
      decodeStoredRow(await snapshot.readRow(entry)),
    );
    tags?.set(row, entry.owner);
    yield row;
  }
}
