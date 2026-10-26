/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import { readRowIds } from './rowReads.js';
import { readStoredBlock, readStoredMetadata } from './rowRangeReads.js';
import { ROW_BLOCK_TYPE } from './rowRecord.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';

export async function readChunkToolPage(
  access: RecordAccess,
  entry: RowEntry,
  start: number,
  count: number,
): Promise<IContent> {
  const ids = await readRowIds(access, entry);
  const metadata = await readStoredMetadata(access, entry, ids);
  let call = 0;
  const selected = ids.header.blocks.flatMap((block, index) => {
    if (block.type !== ROW_BLOCK_TYPE.tool_call)
      return start === 0 ? [index] : [];
    const ordinal = call++;
    return ordinal >= start && ordinal < start + count ? [index] : [];
  });
  const blocks: Uint8Array[] = [];
  for (const index of selected)
    blocks.push(await readStoredBlock(access, entry, index, ids));
  return decodeStoredRow({
    ...metadata,
    header: {
      ...metadata.header,
      blocks: selected.map((index) => ids.header.blocks[index]),
    },
    blocks,
  });
}
