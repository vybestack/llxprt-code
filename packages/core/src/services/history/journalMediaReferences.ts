/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { ROW_BLOCK_TYPE, ROW_FLAG } from '../../journal/rowRecord.js';
import type {
  HistoryMediaOwner,
  PreparedHistoryBatchEffect,
} from './historyBatchContracts.js';
import { isMediaReferenceBlock, type MediaReferenceBlock } from './IContent.js';
import { decodeStoredBlock } from './journalRowCodec.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

/**
 * The media references of the first `rowLimit` rows of `snapshot`, reading
 * only declared media blocks; no text payload is decoded or kept.
 */
export async function* snapshotReferences(
  snapshot: VersionSnapshot,
  rowLimit = snapshot.rows,
): AsyncGenerator<MediaReferenceBlock, void, unknown> {
  let read = 0;
  for await (const entry of snapshot.entries()) {
    if (read++ >= rowLimit) return;
    if ((entry.flags & ROW_FLAG.hasMedia) === 0) continue;
    const { header } = await snapshot.readIds(entry);
    for (let index = 0; index < header.blocks.length; index++) {
      if (header.blocks[index].type !== ROW_BLOCK_TYPE.media) continue;
      const block = decodeStoredBlock(
        await snapshot.readBlock(entry, index),
        ROW_BLOCK_TYPE.media,
      );
      if (isMediaReferenceBlock(block)) yield block;
    }
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
