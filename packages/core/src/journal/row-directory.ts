/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { chunkBlockParts, chunkValue, decodeChunkBlock } from './chunk-row.js';
import { namedBlockLength } from './chunk-fields.js';
import type { RecordAccess } from './recordAccess.js';
import { decodeRowHeader } from './rowRecord.js';
import { transcriptEntries } from './transcript-tree.js';
import { streamRowPiece } from './rowPiece.js';

export interface DirectoryBlock {
  readonly ordinal: number;
  readonly type: number;
  readonly length: number;
  readonly normalizedJson?: boolean;
  parts(): AsyncGenerator<Uint8Array>;
}

/** Traverses one directory leaf and one payload piece at a time. */
export async function* rowDirectory(
  access: RecordAccess,
  rowRef: number,
): AsyncGenerator<DirectoryBlock> {
  const head = await access.readRecordHead(rowRef, 'ROW');
  const header = decodeRowHeader(head.kindHeader);
  const manifest = header.chunk;
  if (manifest !== undefined) {
    let ordinal = 0;
    for await (const entry of transcriptEntries(
      access,
      manifest.blocksRoot,
      'blocks',
      0n,
      false,
    )) {
      const block = decodeChunkBlock(await chunkValue(access, entry.rowRef));
      const index = ordinal++;
      yield {
        ordinal: index,
        type: block.type,
        normalizedJson: block.named !== true,
        length:
          block.named === true
            ? await namedBlockLength(access, block)
            : block.length,
        parts: () => chunkBlockParts(access, manifest, index),
      };
    }
    return;
  }
  for (const [ordinal, block] of header.blocks.entries()) {
    yield {
      ordinal,
      type: block.type,
      length: block.length,
      normalizedJson: true,
      parts: () => streamRowPiece(access, head, block.offset, block.length),
    };
  }
}
