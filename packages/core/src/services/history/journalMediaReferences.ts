/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { collectMediaReferences } from '../../storage/media-reference-lifecycle.js';
import type {
  HistoryMediaOwner,
  PreparedHistoryBatchEffect,
} from './historyBatchContracts.js';
import type { MediaReferenceBlock } from './IContent.js';
import { decodeStoredRow } from './journalRowCodec.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

/**
 * The media references of the first `rowLimit` rows of `snapshot`, one row
 * decoded at a time from the file; nothing is kept.
 */
export async function* snapshotReferences(
  snapshot: VersionSnapshot,
  rowLimit = snapshot.rows,
): AsyncGenerator<MediaReferenceBlock, void, unknown> {
  let read = 0;
  for await (const entry of snapshot.entries()) {
    if (read++ >= rowLimit) return;
    yield* collectMediaReferences([
      decodeStoredRow(await snapshot.readRow(entry)),
    ]);
  }
}

/**
 * The owner's replacement effect for the media in `references`. A journal
 * owner swaps its holdings once the new set is complete, so an owner that
 * cannot do that is refused up front.
 */
export function prepareMediaReplacement(
  owner: HistoryMediaOwner,
  references: AsyncIterable<MediaReferenceBlock>,
  ownership?: RowOwnership,
): PreparedHistoryBatchEffect | Promise<PreparedHistoryBatchEffect> {
  const prepare = owner.prepareReferenceReplacement?.bind(owner);
  if (prepare === undefined) {
    throw new Error('History media owner does not support journal replacement');
  }
  return prepare(references, ownership);
}
