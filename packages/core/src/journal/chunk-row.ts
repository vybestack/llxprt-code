/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { getU64, getU64Big, putU64, putU64Big, viewOf } from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { RecordAccess } from './recordAccess.js';
import type { RecordAppender } from './groupAppender.js';
import { RECORD_KIND } from './recordKinds.js';
import { readValueBody } from './mapEntries.js';
import { transcriptEntries, type TranscriptEntry } from './transcript-tree.js';
import type { RowHeader } from './rowRecord.js';

export const MAX_ARRIVAL_PIECE_BYTES = 64 * 1024;
export interface ChunkManifest {
  readonly transcriptId: bigint;
  readonly blocksRoot: number;
  readonly metaRef: number;
  readonly blockCount: number;
}
export interface ChunkBlock {
  readonly piecesRoot: number;
  readonly length: number;
  readonly type: number;
  readonly ended: boolean;
  readonly named?: boolean;
  readonly snapshot?: { readonly units: number; readonly digest: string };
}
export function encodeManifest(value: ChunkManifest): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = viewOf(bytes);
  putU64Big(view, 0, 'transcriptId', value.transcriptId);
  putU64(view, 8, 'blocksRoot', value.blocksRoot);
  putU64(view, 16, 'metaRef', value.metaRef);
  putU64(view, 24, 'blockCount', value.blockCount);
  return bytes;
}
export function decodeManifest(bytes: Uint8Array): ChunkManifest {
  if (bytes.length !== 32)
    throw new JournalFormatError('Invalid chunk manifest');
  const view = viewOf(bytes);
  return {
    transcriptId: getU64Big(view, 0),
    blocksRoot: getU64(view, 8, 'blocksRoot'),
    metaRef: getU64(view, 16, 'metaRef'),
    blockCount: getU64(view, 24, 'blockCount'),
  };
}
export function encodeChunkBlock(block: ChunkBlock): Uint8Array {
  const bytes = new Uint8Array(block.snapshot === undefined ? 24 : 64);
  const view = viewOf(bytes);
  putU64(view, 0, 'piecesRoot', block.piecesRoot);
  putU64(view, 8, 'length', block.length);
  view.setUint8(16, block.type);
  view.setUint8(17, Number(block.ended));
  view.setUint8(18, Number(block.named === true));
  if (block.snapshot !== undefined) {
    view.setUint8(19, 1);
    putU64(view, 24, 'units', block.snapshot.units);
    bytes.set(Buffer.from(block.snapshot.digest, 'hex'), 32);
  }
  return bytes;
}
export function decodeChunkBlock(bytes: Uint8Array): ChunkBlock {
  if (bytes.length !== 24 && bytes.length !== 64)
    throw new JournalFormatError('Invalid chunk block');
  const view = viewOf(bytes);
  return {
    piecesRoot: getU64(view, 0, 'piecesRoot'),
    length: getU64(view, 8, 'length'),
    type: view.getUint8(16),
    ended: view.getUint8(17) === 1,
    named: view.getUint8(18) === 1,
    snapshot:
      view.getUint8(19) === 1
        ? {
            units: getU64(view, 24, 'units'),
            digest: Buffer.from(bytes.subarray(32, 64)).toString('hex'),
          }
        : undefined,
  };
}
export async function chunkValue(
  access: RecordAccess,
  ref: number,
): Promise<Uint8Array> {
  const head = await access.readRecordHead(ref, 'VALUE');
  if (head.kind !== RECORD_KIND.VALUE)
    throw new JournalFormatError('Chunk descriptor is not VALUE');
  return readValueBody(access, head);
}
export function appendChunkValue(
  target: RecordAppender,
  key: string,
  bytes: Uint8Array,
): Promise<number> {
  return target.append({
    kind: RECORD_KIND.VALUE,
    kindHeader: new TextEncoder().encode(key),
    body: { length: bytes.length, chunks: [bytes] },
  });
}
export async function findChunkEntry(
  access: RecordAccess,
  root: number,
  mode: 'blocks' | 'pieces' | 'transcript',
  id: bigint,
): Promise<TranscriptEntry> {
  const found = await transcriptEntries(access, root, mode, id, false).next();
  if (found.value?.transcriptId !== id)
    throw new JournalFormatError(`Missing ${mode} entry ${id}`);
  return found.value;
}
export async function chunkBlock(
  access: RecordAccess,
  manifest: ChunkManifest,
  ordinal: number,
): Promise<ChunkBlock> {
  const entry = await findChunkEntry(
    access,
    manifest.blocksRoot,
    'blocks',
    BigInt(ordinal + 1),
  );
  return decodeChunkBlock(await chunkValue(access, entry.rowRef));
}
export async function hydrateChunkHeader(
  access: RecordAccess,
  header: RowHeader,
): Promise<RowHeader> {
  if (header.chunk === undefined) return header;
  const blocks = [];
  for await (const entry of transcriptEntries(
    access,
    header.chunk.blocksRoot,
    'blocks',
    0n,
    false,
  )) {
    const block = decodeChunkBlock(await chunkValue(access, entry.rowRef));
    blocks.push({
      offset: blocks.length,
      length: block.length,
      type: block.type,
    });
  }
  if (blocks.length !== header.chunk.blockCount)
    throw new JournalFormatError('Chunk block count mismatch');
  return { ...header, blocks };
}
export async function* chunkBlockParts(
  access: RecordAccess,
  manifest: ChunkManifest,
  ordinal: number,
): AsyncGenerator<Uint8Array> {
  const block = await chunkBlock(access, manifest, ordinal);
  if (block.named === true) {
    const { namedBlockParts } = await import('./chunk-fields.js');
    yield* namedBlockParts(access, manifest, ordinal, block);
  } else yield* chunkFieldParts(access, manifest, ordinal, block, 0);
}
export async function* chunkFieldParts(
  access: RecordAccess,
  manifest: ChunkManifest,
  ordinal: number,
  block: ChunkBlock,
  fieldCode: number,
): AsyncGenerator<Uint8Array> {
  let position = 0;
  for await (const entry of transcriptEntries(
    access,
    block.piecesRoot,
    'pieces',
    0n,
    false,
  )) {
    const head = await access.readRecordHead(entry.rowRef, 'PIECE');
    if (
      head.kind !== RECORD_KIND.PIECE ||
      head.bodyLen > MAX_ARRIVAL_PIECE_BYTES ||
      head.bodyLen !== entry.recordLength ||
      entry.transcriptId !== BigInt(position + 1)
    )
      throw new JournalFormatError('Invalid arrival piece');
    const view = viewOf(head.kindHeader);
    if (
      head.kindHeader.length !== 32 ||
      getU64Big(view, 0) !== manifest.transcriptId ||
      getU64(view, 8, 'ordinal') !== ordinal ||
      getU64(view, 24, 'position') !== position
    )
      throw new JournalFormatError('Arrival piece identity mismatch');
    if (getU64(view, 16, 'fieldCode') !== fieldCode)
      throw new JournalFormatError('Arrival piece field mismatch');
    let verified: Uint8Array | undefined;
    for await (const part of access.readRecordBody(
      head,
      MAX_ARRIVAL_PIECE_BYTES,
      'PIECE',
    ))
      verified = part;
    if (verified !== undefined) yield verified;
    position += head.bodyLen;
  }
  if (position !== block.length)
    throw new JournalFormatError('Chunk length mismatch');
}
export async function readChunkBlock(
  access: RecordAccess,
  manifest: ChunkManifest,
  ordinal: number,
): Promise<Uint8Array> {
  const block = await chunkBlock(access, manifest, ordinal);
  const length =
    block.named === true
      ? await (
          await import('./chunk-fields.js')
        ).namedBlockLength(access, block)
      : block.length;
  const bytes = new Uint8Array(length);
  let position = 0;
  for await (const part of chunkBlockParts(access, manifest, ordinal)) {
    bytes.set(part, position);
    position += part.length;
  }
  return bytes;
}
export function pieceHeader(
  id: bigint,
  ordinal: number,
  position: number,
  fieldCode = 0,
): Uint8Array {
  const bytes = new Uint8Array(32);
  const view = viewOf(bytes);
  putU64Big(view, 0, 'transcriptId', id);
  putU64(view, 8, 'ordinal', ordinal);
  putU64(view, 16, 'fieldCode', fieldCode);
  putU64(view, 24, 'position', position);
  return bytes;
}
export function directoryEntry(
  id: bigint,
  ref: number,
  length = 0,
): TranscriptEntry {
  return {
    transcriptId: id,
    rowRef: ref,
    recordLength: length,
    label: 0n,
    revision: 1,
    audience: 0,
    status: 0,
    attemptRef: 0,
    supersedesId: 0n,
    presentationRef: 0,
  };
}
