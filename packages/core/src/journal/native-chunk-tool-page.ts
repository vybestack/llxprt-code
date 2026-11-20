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
  const completed: number[] = [];
  const completedTools = new Set(ids.header.ids.map((id) => id.block));
  for (const index of selected) {
    const type = ids.header.blocks[index].type;
    if (
      (type === ROW_BLOCK_TYPE.tool_call ||
        type === ROW_BLOCK_TYPE.tool_response) &&
      !completedTools.has(index)
    )
      continue;
    blocks.push(await readStoredBlock(access, entry, index, ids));
    completed.push(index);
  }
  return decodeStoredRow({
    ...metadata,
    header: {
      ...metadata.header,
      blocks: completed.map((index) => ids.header.blocks[index]),
    },
    blocks,
  });
}
