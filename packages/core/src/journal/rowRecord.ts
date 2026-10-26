/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  encodeManifest,
  decodeManifest,
  type ChunkManifest,
} from './chunk-row.js';
import { createHash } from 'node:crypto';
import {
  assertAllZero,
  getU64,
  getU64Big,
  putBytes,
  putU8,
  putU16,
  putU32,
  putU64,
  putU64Big,
  span,
  viewOf,
} from './bytes.js';
import { JournalFormatError } from './errors.js';
import { ROW_PIECE_CRC_BYTES } from './rowPiece.js';

export const ROW_SPEAKER = { human: 0, ai: 1, tool: 2 } as const;
export const ROW_ID_KIND = { call: 0, response: 1 } as const;

/**
 * The `type` byte of a block directory entry. The row codec writes these and
 * the row entry counts `tool_call` and `tool_response` blocks by them
 * (design 2.7).
 */
export const ROW_BLOCK_TYPE = {
  text: 0,
  tool_call: 1,
  tool_response: 2,
  media: 3,
  thinking: 4,
  code: 5,
} as const;

/**
 * Bits of the `flags` field, in the order the design lists them (2.4). The
 * design names the flags and not their bit positions.
 */
export const ROW_FLAG = {
  curated: 1 << 0,
  hasThinking: 1 << 1,
  hasToolCall: 1 << 2,
  hasToolResponse: 1 << 3,
  hasMedia: 1 << 4,
  hasImage: 1 << 5,
  hasCacheableBlock: 1 << 6,
  cacheAnchor: 1 << 7,
  synthetic: 1 << 8,
  invalidateResponses: 1 << 9,
  responseParent: 1 << 10,
} as const;

export const CHRONOLOGY_SEQ_NONE = 0xffff_ffff_ffff_ffffn;

/** Design 2.7: every field of the fixed part sits at its natural alignment. */
export const ROW_FIXED_LAYOUT = {
  label: span(0, 8),
  owner: span(8, 4),
  speaker: span(12, 1),
  reserved: span(13, 1),
  flags: span(14, 2),
  blockCount: span(16, 4),
  idCount: span(20, 4),
  idsLen: span(24, 4),
  metaLen: span(28, 4),
  chronologySeq: span(32, 8),
  chronologyUserTurn: span(40, 4),
  chronologyStep: span(44, 4),
  chronologyRecordedAt: span(48, 8),
  parentEndpoint: span(56, 8),
};
const FIXED = ROW_FIXED_LAYOUT;
export const ROW_FIXED_BYTES = 64;

export const ROW_BLOCK_LAYOUT = {
  offset: span(0, 8),
  length: span(8, 8),
  type: span(16, 1),
};
const BLOCK = ROW_BLOCK_LAYOUT;
export const BLOCK_DIR_ENTRY_BYTES = 17;

export const ROW_ID_TUPLE_LAYOUT = {
  idHash: span(0, 16),
  kind: span(16, 1),
  block: span(17, 4),
  score: span(21, 1),
  nameLen: span(22, 4),
};
const TUPLE = ROW_ID_TUPLE_LAYOUT;
export const ID_TUPLE_BYTES = 26;

/** The frame's `headerLen` is a u32 and is the only bound on the kind header. */
export const MAX_ROW_HEADER_BYTES = 0xffff_ffff;

/** One block of the body: where it starts (relative to the body start), its length and type. */
export interface RowBlockEntry {
  readonly offset: number;
  readonly length: number;
  readonly type: number;
}

/** One tool call or response id of the row. `idHash` is the first 16 bytes of the id's SHA-256. */
export interface RowIdTuple {
  readonly idHash: Uint8Array;
  readonly kind: number;
  readonly block: number;
  readonly score: number;
  readonly nameLen: number;
}

/** The kind header of a `ROW` record. Block and id counts are the array lengths. */
export interface RowHeader {
  readonly chunk?: ChunkManifest;
  readonly label: bigint;
  readonly owner: number;
  readonly speaker: number;
  readonly flags: number;
  readonly idsLen: number;
  readonly metaLen: number;
  readonly chronologySeq: bigint;
  readonly chronologyUserTurn: number;
  readonly chronologyStep: number;
  readonly chronologyRecordedAt: number;
  readonly parentEndpoint: bigint;
  readonly blocks: readonly RowBlockEntry[];
  readonly ids: readonly RowIdTuple[];
}

export function rowHeaderBytes(blockCount: number, idCount: number): number {
  return (
    ROW_FIXED_BYTES +
    BLOCK_DIR_ENTRY_BYTES * blockCount +
    ID_TUPLE_BYTES * idCount
  );
}

/** The counts are u32 and the whole header must fit the frame's u32 `headerLen`. */
export function assertRowHeaderFits(blockCount: number, idCount: number): void {
  const counts = { blockCount, idCount };
  for (const [name, count] of Object.entries(counts)) {
    if (!Number.isSafeInteger(count) || count < 0 || count > 0xffff_ffff) {
      throw new JournalFormatError(`${name} ${count} does not fit 32 bits`);
    }
  }
  const total = rowHeaderBytes(blockCount, idCount);
  if (total > MAX_ROW_HEADER_BYTES) {
    throw new JournalFormatError(
      `Row header of ${total} bytes (${blockCount} blocks, ${idCount} ids) exceeds the ${MAX_ROW_HEADER_BYTES} a 32-bit headerLen can describe`,
    );
  }
}

function encodeFixedPart(view: DataView, row: RowHeader): void {
  if (row.speaker > ROW_SPEAKER.tool) {
    throw new JournalFormatError(`speaker ${row.speaker} is not 0, 1 or 2`);
  }
  putU64Big(view, FIXED.label.offset, 'label', row.label);
  putU32(view, FIXED.owner.offset, 'owner', row.owner);
  putU8(view, FIXED.speaker.offset, 'speaker', row.speaker);
  putU16(view, FIXED.flags.offset, 'flags', row.flags);
  putU32(view, FIXED.blockCount.offset, 'blockCount', row.blocks.length);
  putU32(view, FIXED.idCount.offset, 'idCount', row.ids.length);
  putU32(view, FIXED.idsLen.offset, 'idsLen', row.idsLen);
  putU32(view, FIXED.metaLen.offset, 'metaLen', row.metaLen);
  putU64Big(
    view,
    FIXED.chronologySeq.offset,
    'chronologySeq',
    row.chronologySeq,
  );
  putU32(
    view,
    FIXED.chronologyUserTurn.offset,
    'chronologyUserTurn',
    row.chronologyUserTurn,
  );
  putU32(
    view,
    FIXED.chronologyStep.offset,
    'chronologyStep',
    row.chronologyStep,
  );
  putU64(
    view,
    FIXED.chronologyRecordedAt.offset,
    'chronologyRecordedAt',
    row.chronologyRecordedAt,
  );
  putU64Big(
    view,
    FIXED.parentEndpoint.offset,
    'parentEndpoint',
    row.parentEndpoint,
  );
}

function encodeBlockEntry(
  view: DataView,
  base: number,
  entry: RowBlockEntry,
): void {
  putU64(view, base + BLOCK.offset.offset, 'block offset', entry.offset);
  putU64(view, base + BLOCK.length.offset, 'block length', entry.length);
  putU8(view, base + BLOCK.type.offset, 'block type', entry.type);
}

function encodeIdTuple(
  bytes: Uint8Array,
  view: DataView,
  base: number,
  tuple: RowIdTuple,
): void {
  if (tuple.kind > ROW_ID_KIND.response) {
    throw new JournalFormatError(
      `id kind ${tuple.kind} is not call or response`,
    );
  }
  putBytes(
    bytes,
    base + TUPLE.idHash.offset,
    'idHash',
    tuple.idHash,
    TUPLE.idHash.size,
  );
  putU8(view, base + TUPLE.kind.offset, 'id kind', tuple.kind);
  putU32(view, base + TUPLE.block.offset, 'id block', tuple.block);
  putU8(view, base + TUPLE.score.offset, 'id score', tuple.score);
  putU32(view, base + TUPLE.nameLen.offset, 'id nameLen', tuple.nameLen);
}

export function encodeRowHeader(row: RowHeader): Uint8Array {
  assertRowHeaderFits(row.blocks.length, row.ids.length);
  const bytes = new Uint8Array(
    rowHeaderBytes(row.blocks.length, row.ids.length),
  );
  const view = viewOf(bytes);
  encodeFixedPart(view, row);
  let base = ROW_FIXED_BYTES;
  for (const entry of row.blocks) {
    encodeBlockEntry(view, base, entry);
    base += BLOCK_DIR_ENTRY_BYTES;
  }
  for (const tuple of row.ids) {
    encodeIdTuple(bytes, view, base, tuple);
    base += ID_TUPLE_BYTES;
  }
  if (row.chunk === undefined) return bytes;
  bytes[13] = 1;
  const manifest = encodeManifest(row.chunk);
  const result = new Uint8Array(bytes.length + manifest.length);
  result.set(bytes);
  result.set(manifest, bytes.length);
  return result;
}

function decodeBlockEntry(view: DataView, base: number): RowBlockEntry {
  return {
    offset: getU64(view, base + BLOCK.offset.offset, 'block offset'),
    length: getU64(view, base + BLOCK.length.offset, 'block length'),
    type: view.getUint8(base + BLOCK.type.offset),
  };
}

function decodeIdTuple(
  bytes: Uint8Array,
  view: DataView,
  base: number,
): RowIdTuple {
  const kind = view.getUint8(base + TUPLE.kind.offset);
  if (kind > ROW_ID_KIND.response) {
    throw new JournalFormatError(`id kind ${kind} is not call or response`);
  }
  const hashStart = base + TUPLE.idHash.offset;
  return {
    idHash: bytes.slice(hashStart, hashStart + TUPLE.idHash.size),
    kind,
    block: view.getUint32(base + TUPLE.block.offset, true),
    score: view.getUint8(base + TUPLE.score.offset),
    nameLen: view.getUint32(base + TUPLE.nameLen.offset, true),
  };
}

export function decodeRowHeader(bytes: Uint8Array): RowHeader {
  if (bytes.length < ROW_FIXED_BYTES) {
    throw new JournalFormatError(
      `Row header of ${bytes.length} bytes is shorter than its ${ROW_FIXED_BYTES}-byte fixed part`,
    );
  }
  const view = viewOf(bytes);
  const blockCount = view.getUint32(FIXED.blockCount.offset, true);
  const idCount = view.getUint32(FIXED.idCount.offset, true);
  const chunked = view.getUint8(13) === 1;
  if (chunked && bytes.length !== rowHeaderBytes(blockCount, idCount) + 32)
    throw new JournalFormatError('Invalid chunk ROW reserved tag');
  if (
    bytes.length !==
    rowHeaderBytes(blockCount, idCount) + (chunked ? 32 : 0)
  ) {
    throw new JournalFormatError(
      `Row header of ${bytes.length} bytes does not match ${blockCount} blocks and ${idCount} ids (${rowHeaderBytes(blockCount, idCount)} bytes)`,
    );
  }
  if (!chunked)
    assertAllZero(
      bytes,
      FIXED.reserved.offset,
      FIXED.reserved.offset + 1,
      'Row header reserved byte',
    );
  const speaker = view.getUint8(FIXED.speaker.offset);
  if (speaker > ROW_SPEAKER.tool) {
    throw new JournalFormatError(`Row speaker ${speaker} is not 0, 1 or 2`);
  }
  const blocks: RowBlockEntry[] = [];
  let base = ROW_FIXED_BYTES;
  for (
    let index = 0;
    index < blockCount;
    index++, base += BLOCK_DIR_ENTRY_BYTES
  ) {
    blocks.push(decodeBlockEntry(view, base));
  }
  const ids: RowIdTuple[] = [];
  for (let index = 0; index < idCount; index++, base += ID_TUPLE_BYTES) {
    ids.push(decodeIdTuple(bytes, view, base));
  }
  return {
    ...(chunked
      ? { chunk: decodeManifest(bytes.subarray(bytes.length - 32)) }
      : {}),
    label: getU64Big(view, FIXED.label.offset),
    owner: view.getUint32(FIXED.owner.offset, true),
    speaker,
    flags: view.getUint16(FIXED.flags.offset, true),
    idsLen: view.getUint32(FIXED.idsLen.offset, true),
    metaLen: view.getUint32(FIXED.metaLen.offset, true),
    chronologySeq: getU64Big(view, FIXED.chronologySeq.offset),
    chronologyUserTurn: view.getUint32(FIXED.chronologyUserTurn.offset, true),
    chronologyStep: view.getUint32(FIXED.chronologyStep.offset, true),
    chronologyRecordedAt: getU64(
      view,
      FIXED.chronologyRecordedAt.offset,
      'chronologyRecordedAt',
    ),
    parentEndpoint: getU64Big(view, FIXED.parentEndpoint.offset),
    blocks,
    ids,
  };
}

/**
 * The body is the id piece, the metadata piece, then the blocks. Checks that
 * the pieces and every block range lie inside a body of `bodyLen` bytes and
 * that no block starts inside the two pieces before it.
 */
export function validateRowAgainstBody(row: RowHeader, bodyLen: number): void {
  if (row.chunk !== undefined) {
    if (bodyLen !== 0)
      throw new JournalFormatError('Chunk manifest has a body');
    return;
  }
  const blocksStart = row.idsLen + row.metaLen + 2 * ROW_PIECE_CRC_BYTES;
  if (blocksStart > bodyLen) {
    throw new JournalFormatError(
      `Row pieces of ${blocksStart} bytes (ids ${row.idsLen}, metadata ${row.metaLen}, CRC suffixes) run past the ${bodyLen}-byte body`,
    );
  }
  let next = blocksStart;
  row.blocks.forEach((block, index) => {
    if (
      block.offset !== next ||
      block.offset + block.length + ROW_PIECE_CRC_BYTES > bodyLen
    ) {
      throw new JournalFormatError(
        `Row block ${index} at ${block.offset} for ${block.length} bytes does not match the block area ${next} to ${bodyLen}`,
      );
    }
    next += block.length + ROW_PIECE_CRC_BYTES;
  });
  if (next !== bodyLen)
    throw new JournalFormatError(
      'Row body has trailing bytes outside its pieces',
    );
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_STRICT_DECODER = new TextDecoder('utf-8', { fatal: true });
const ID_LENGTH_BYTES = 4;

/** The first 128 bits of the SHA-256 of the exact id string. */
export function hashId(rawId: string): Uint8Array {
  return Uint8Array.from(
    createHash('sha256').update(rawId, 'utf8').digest().subarray(0, 16),
  );
}

/** Each id as `u32 byteLength` and UTF-8 bytes, in tuple order. */
export function encodeIdPiece(ids: readonly string[]): Uint8Array {
  const encoded = ids.map((id) => {
    const bytes = UTF8_ENCODER.encode(id);
    if (UTF8_STRICT_DECODER.decode(bytes) !== id) {
      throw new JournalFormatError(
        `Id of ${id.length} characters is not well-formed Unicode and cannot be stored as UTF-8`,
      );
    }
    return bytes;
  });
  const total = encoded.reduce(
    (sum, bytes) => sum + ID_LENGTH_BYTES + bytes.length,
    0,
  );
  const piece = new Uint8Array(total);
  const view = viewOf(piece);
  let position = 0;
  for (const bytes of encoded) {
    putU32(view, position, 'id length', bytes.length);
    piece.set(bytes, position + ID_LENGTH_BYTES);
    position += ID_LENGTH_BYTES + bytes.length;
  }
  return piece;
}

export function decodeIdPiece(piece: Uint8Array, idCount: number): string[] {
  const view = viewOf(piece);
  const ids: string[] = [];
  let position = 0;
  for (let index = 0; index < idCount; index++) {
    if (position + ID_LENGTH_BYTES > piece.length) {
      throw new JournalFormatError(
        `Id piece ends before id ${index} of ${idCount}`,
      );
    }
    const length = view.getUint32(position, true);
    const start = position + ID_LENGTH_BYTES;
    if (start + length > piece.length) {
      throw new JournalFormatError(
        `Id piece ends inside id ${index} of ${idCount}`,
      );
    }
    ids.push(decodeUtf8Id(piece.subarray(start, start + length), index));
    position = start + length;
  }
  if (position !== piece.length) {
    throw new JournalFormatError(
      `Id piece has ${piece.length - position} trailing bytes after ${idCount} ids`,
    );
  }
  return ids;
}

function decodeUtf8Id(bytes: Uint8Array, index: number): string {
  try {
    return UTF8_STRICT_DECODER.decode(bytes);
  } catch (cause) {
    throw new JournalFormatError(
      `Id ${index} in the id piece is not valid UTF-8`,
      { cause },
    );
  }
}
