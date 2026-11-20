/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ROW_FLAG } from '../../journal/rowRecord.js';
import type { TranscriptRevision } from '../../journal/transcript-revision.js';
import { isMediaReferenceBlock } from './IContent.js';
import { droppedBlockOf } from './journalMediaDrop.js';
import { decodeStoredRow, encodeContentRow } from './journalRowCodec.js';

/**
 * The transcript revision of a row a context replacement removes: each stored
 * media reference becomes `media_dropped` (design 10.4), so the transcript
 * keeps where the image came from and names no blob once the history's
 * reservation is released. Inline bytes live in the journal and stay.
 */
export function droppedTranscriptMedia(
  resumeBoundary: bigint | undefined,
): TranscriptRevision {
  return {
    flags: ROW_FLAG.hasMedia,
    revise(stored) {
      const row = decodeStoredRow(stored, resumeBoundary);
      if (!row.blocks.some(isMediaReferenceBlock)) return undefined;
      const droppedAt = new Date().toISOString();
      return encodeContentRow(
        {
          ...row,
          blocks: row.blocks.map((block) =>
            isMediaReferenceBlock(block)
              ? droppedBlockOf(block, droppedAt, row)
              : block,
          ),
        },
        { owner: stored.header.owner },
      );
    },
  };
}
