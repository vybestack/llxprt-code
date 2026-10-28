/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '../services/history/IContent.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import { RECORD_KIND } from './recordKinds.js';
import { ROW_BLOCK_TYPE } from './rowRecord.js';
import { readRowIds, type RowIds } from './rowReads.js';
import { readStoredMetadata } from './rowRangeReads.js';
import { chunkBlockParts } from './chunk-row.js';
import { streamRowPiece } from './rowPiece.js';
import { jsonTextSlices } from './json-text-slices.js';

async function* pages(
  access: RecordAccess,
  entry: RowEntry,
  ids: RowIds,
  size: number,
): AsyncGenerator<IContent> {
  const metadata = decodeStoredRow({
    ...(await readStoredMetadata(access, entry, ids)),
    header: { ...ids.header, blocks: [] },
    blocks: [],
  });
  if (
    metadata.speaker === 'human' &&
    metadata.metadata?.displayText !== undefined
  ) {
    yield metadata;
    return;
  }
  for (let index = 0; index < ids.header.blocks.length; index++) {
    const block = ids.header.blocks[index];
    if (ids.head === undefined) throw new Error('Missing text row frame');
    const parts =
      ids.header.chunk === undefined
        ? streamRowPiece(access, ids.head, block.offset, block.length)
        : chunkBlockParts(access, ids.header.chunk, index);
    for await (const text of jsonTextSlices(parts, 'text', size))
      yield { ...metadata, blocks: [{ type: 'text', text }] };
  }
}

/** Undefined means ordinary block projection remains appropriate for this row. */
export async function nativeTextSlices(
  access: RecordAccess,
  entry: RowEntry,
  size: number,
): Promise<AsyncIterable<IContent> | undefined> {
  const head = await access.readRecordHead(entry.recordOffset, 'ROW');
  if (head.kind !== RECORD_KIND.ROW) return undefined;
  const ids = await readRowIds(access, entry);
  if (
    ids.header.blocks.length === 0 ||
    ids.header.blocks.some((block) => block.type !== ROW_BLOCK_TYPE.text)
  )
    return undefined;
  if (ids.header.blocks.every((block) => block.length <= size * 2))
    return undefined;
  return pages(access, entry, ids, size);
}
