/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { DirectoryBlock } from '../../journal/row-directory.js';
import { ROW_BLOCK_TYPE } from '../../journal/rowRecord.js';
import { MetadataJsonProjection } from '../../recording/metadataJsonProjection.js';
import type {
  ContentMetadata,
  IContent,
  MediaReferenceBlock,
} from './IContent.js';
import { isMediaReferenceBlock } from './IContent.js';
import { decodeStoredRow } from './journalRowCodec.js';

export interface SealedHistoryRow {
  readonly label: bigint;
  readonly speaker: IContent['speaker'];
  readonly metadata?: ContentMetadata;
}

async function readReference(
  block: DirectoryBlock,
): Promise<MediaReferenceBlock | undefined> {
  const fields = new Set<string>();
  const parser = new MetadataJsonProjection({
    begin: (path) => {
      if (path.length === 1 && typeof path[0] === 'string') fields.add(path[0]);
    },
    retain: (path) => path[0] !== 'data' && path[0] !== 'originalData',
  });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const part of block.parts())
    parser.push(decoder.decode(part, { stream: true }));
  parser.push(decoder.decode());
  const value = parser.finish();
  return !fields.has('data') && isMediaReferenceBlock(value)
    ? value
    : undefined;
}

async function* references(
  snapshot: VersionSnapshot,
  entry: Awaited<ReturnType<VersionSnapshot['entryAt']>>,
): AsyncGenerator<MediaReferenceBlock> {
  for await (const block of snapshot.blocks(entry)) {
    if (block.type !== ROW_BLOCK_TYPE.media) continue;
    const reference = await readReference(block);
    if (reference !== undefined) yield reference;
  }
}

export async function observeSealedRow(
  snapshot: VersionSnapshot,
  observe: (
    row: SealedHistoryRow,
    media: AsyncIterable<MediaReferenceBlock>,
  ) => Promise<void>,
): Promise<SealedHistoryRow> {
  if (snapshot.rows === 0) throw new Error('Sealed response is missing');
  const entry = await snapshot.entryAt(snapshot.rows - 1);
  const content = decodeStoredRow(await snapshot.readMetadata(entry));
  const row = {
    label: entry.label,
    speaker: content.speaker,
    metadata: content.metadata,
  };
  await observe(row, references(snapshot, entry));
  return row;
}
