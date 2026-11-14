/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from './recordAccess.js';
import type { RecordAppender } from './groupAppender.js';
import type { ChunkManifest } from './chunk-row.js';
import { chunkValue, decodeChunkBlock, findChunkEntry } from './chunk-row.js';
import { ROW_BLOCK_TYPE } from './rowRecord.js';
import { TranscriptTreeWriter, transcriptEntries } from './transcript-tree.js';

export async function finalizedBlocksRoot(
  access: () => RecordAccess,
  target: RecordAppender,
  manifest: ChunkManifest,
  readOrder: (index: number) => Promise<Uint8Array | undefined>,
): Promise<number> {
  if ((await readOrder(0)) === undefined) return manifest.blocksRoot;
  const tree = new TranscriptTreeWriter(access, target, 'blocks');
  let root = 0;
  let count = 0;
  let tools = 0;
  for await (const entry of transcriptEntries(
    access(),
    manifest.blocksRoot,
    'blocks',
    0n,
    false,
  )) {
    const block = decodeChunkBlock(await chunkValue(access(), entry.rowRef));
    if (block.type === ROW_BLOCK_TYPE.tool_call) {
      tools++;
      continue;
    }
    root = await tree.insert(root, {
      ...entry,
      transcriptId: BigInt(++count),
      label: entry.transcriptId,
    });
  }
  for (let index = 0; index < tools; index++) {
    const bytes = await readOrder(index);
    if (bytes === undefined || bytes.length !== 4)
      throw new Error('Missing finalized tool order');
    const ordinal = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(0);
    const entry = await findChunkEntry(
      access(),
      manifest.blocksRoot,
      'blocks',
      BigInt(ordinal + 1),
    );
    const block = decodeChunkBlock(await chunkValue(access(), entry.rowRef));
    if (block.type !== ROW_BLOCK_TYPE.tool_call || !block.ended)
      throw new Error('Invalid finalized tool block');
    root = await tree.insert(root, {
      ...entry,
      transcriptId: BigInt(++count),
      label: entry.transcriptId,
    });
  }
  if (count !== manifest.blockCount)
    throw new Error('Finalized block count mismatch');
  return root;
}
