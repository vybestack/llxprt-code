/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { crc32, putU32, viewOf } from './bytes.js';
import { JournalFrameError } from './errors.js';
import type { FrameHead } from './frame.js';
import type { RecordAccess } from './recordAccess.js';

export const ROW_PIECE_CRC_BYTES = 4;

/** Piece boundaries are covered by the frame CRC; the suffix checks the reached payload. */
export function* rowPieceParts(
  pieces: Iterable<Uint8Array>,
): Generator<Uint8Array> {
  for (const piece of pieces) {
    const suffix = new Uint8Array(ROW_PIECE_CRC_BYTES);
    putU32(viewOf(suffix), 0, 'row piece CRC', crc32(piece));
    yield piece;
    yield suffix;
  }
}

export function checkedRowPiece(
  access: RecordAccess,
  head: FrameHead,
  bytes: Uint8Array,
  offset: number,
  length: number,
): Uint8Array {
  const piece = bytes.subarray(0, length);
  const actual = crc32(piece);
  const stored = viewOf(bytes).getUint32(length, true);
  if (stored !== actual) {
    throw access.recordError(
      head,
      new JournalFrameError(
        'body-crc-mismatch',
        head.offset,
        `ROW piece at body offset ${offset}: CRC ${stored.toString(16)} does not match ${actual.toString(16)}`,
      ),
    );
  }
  return piece;
}

export async function readRowPiece(
  access: RecordAccess,
  head: FrameHead,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  const bytes = await access.readRecordRange(
    head,
    offset,
    length + ROW_PIECE_CRC_BYTES,
  );
  return checkedRowPiece(access, head, bytes, offset, length);
}
