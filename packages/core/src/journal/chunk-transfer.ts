/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { OFFSET } from './offsetFields.js';
import { remapOffset } from './recordTransfer.js';
import type { GroupCopier } from './groupCopier.js';
import type { FrameHead } from './frame.js';
import { decodeRowHeader, encodeRowHeader } from './rowRecord.js';
import { copyTranscriptTree } from './transcript-transfer.js';
import { RECORD_KIND } from './recordKinds.js';
import { decodeChunkBlock, encodeChunkBlock } from './chunk-row.js';
import { readValueBody } from './mapEntries.js';

export async function copyChunkRow(
  copier: GroupCopier,
  head: FrameHead,
): Promise<number | undefined> {
  const header = decodeRowHeader(head.kindHeader);
  if (header.chunk === undefined) return undefined;
  const chunk = header.chunk;
  const blocksRoot = await remapOffset(
    OFFSET.chunkBlocks,
    chunk.blocksRoot,
    async (ref) => (await copyTranscriptTree(copier, ref, 'blocks')).ref,
  );
  const metaRef = await remapOffset(OFFSET.chunkMeta, chunk.metaRef, (ref) =>
    copier.copyRecord(ref, 'VALUE'),
  );
  const ref = await copier.append(
    {
      kind: RECORD_KIND.ROW,
      kindHeader: encodeRowHeader({
        ...header,
        chunk: { ...chunk, blocksRoot, metaRef },
      }),
    },
    'ROW',
  );
  await copier.remember(head.offset, ref);
  return ref;
}
export async function copyChunkDescriptor(
  copier: GroupCopier,
  head: FrameHead,
): Promise<number | undefined> {
  if (new TextDecoder().decode(head.kindHeader) !== 'recording:block')
    return undefined;
  const block = decodeChunkBlock(await readValueBody(copier.source, head));
  const piecesRoot = await remapOffset(
    OFFSET.blockPieces,
    block.piecesRoot,
    async (ref) => (await copyTranscriptTree(copier, ref, 'pieces')).ref,
  );
  const bytes = encodeChunkBlock({ ...block, piecesRoot });
  const ref = await copier.append(
    {
      kind: RECORD_KIND.VALUE,
      kindHeader: head.kindHeader,
      body: { length: bytes.length, chunks: [bytes] },
    },
    'VALUE',
  );
  await copier.remember(head.offset, ref);
  return ref;
}
