/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomBytes } from 'node:crypto';
import {
  assertAllZero,
  assertLength,
  crc32,
  putBytes,
  putU32,
  putU64,
  getU64,
  span,
  viewOf,
} from './bytes.js';
import { JournalFormatError } from './errors.js';

/** `LLXJRNL\0` */
export const JOURNAL_MAGIC: Uint8Array = Uint8Array.of(
  0x4c,
  0x4c,
  0x58,
  0x4a,
  0x52,
  0x4e,
  0x4c,
  0x00,
);
/** The JSONL journals were versions 1 and 2. */
export const JOURNAL_FORMAT_VERSION = 12;
export const JOURNAL_HEADER_BYTES = 64;

const HEADER_LAYOUT = {
  magic: span(0, 8),
  formatVersion: span(8, 4),
  flags: span(12, 4),
  fileId: span(16, 16),
  syncMarker: span(32, 8),
  createdAtMs: span(40, 8),
  reserved: span(48, 12),
  crc: span(60, 4),
};
const CRC_COVERS_BYTES = 60;

export interface JournalHeader {
  /** 16 random bytes naming this file. */
  readonly fileId: Uint8Array;
  /** 8 random bytes that end every trailer (design 3.1). */
  readonly syncMarker: Uint8Array;
  readonly createdAtMs: number;
}

export function createJournalHeader(
  nowMs: () => number,
  random: (length: number) => Uint8Array = randomBytes,
): JournalHeader {
  return {
    fileId: Uint8Array.from(random(HEADER_LAYOUT.fileId.size)),
    syncMarker: Uint8Array.from(random(HEADER_LAYOUT.syncMarker.size)),
    createdAtMs: nowMs(),
  };
}

export function encodeJournalHeader(header: JournalHeader): Uint8Array {
  const bytes = new Uint8Array(JOURNAL_HEADER_BYTES);
  const view = viewOf(bytes);
  const at = HEADER_LAYOUT;
  bytes.set(JOURNAL_MAGIC, at.magic.offset);
  putU32(
    view,
    at.formatVersion.offset,
    'formatVersion',
    JOURNAL_FORMAT_VERSION,
  );
  putBytes(bytes, at.fileId.offset, 'fileId', header.fileId, at.fileId.size);
  putBytes(
    bytes,
    at.syncMarker.offset,
    'syncMarker',
    header.syncMarker,
    at.syncMarker.size,
  );
  putU64(view, at.createdAtMs.offset, 'createdAtMs', header.createdAtMs);
  putU32(
    view,
    at.crc.offset,
    'header CRC',
    crc32(bytes.subarray(0, CRC_COVERS_BYTES)),
  );
  return bytes;
}

export function decodeJournalHeader(bytes: Uint8Array): JournalHeader {
  assertLength(bytes, JOURNAL_HEADER_BYTES, 'Journal header');
  const view = viewOf(bytes);
  const at = HEADER_LAYOUT;
  if (
    view.getUint32(at.crc.offset, true) !==
    crc32(bytes.subarray(0, CRC_COVERS_BYTES))
  ) {
    throw new JournalFormatError('Journal header CRC mismatch');
  }
  if (
    !bytes.subarray(0, 8).every((byte, index) => byte === JOURNAL_MAGIC[index])
  ) {
    throw new JournalFormatError('Journal header magic mismatch');
  }
  if (
    view.getUint32(at.formatVersion.offset, true) !== JOURNAL_FORMAT_VERSION
  ) {
    throw new JournalFormatError('Journal header format version mismatch');
  }
  if (view.getUint32(at.flags.offset, true) !== 0) {
    throw new JournalFormatError('Journal header flags must be zero');
  }
  assertAllZero(
    bytes,
    at.reserved.offset,
    at.reserved.offset + at.reserved.size,
    'Journal header reserved bytes',
  );
  return {
    fileId: bytes.slice(at.fileId.offset, at.fileId.offset + at.fileId.size),
    syncMarker: bytes.slice(
      at.syncMarker.offset,
      at.syncMarker.offset + at.syncMarker.size,
    ),
    createdAtMs: getU64(view, at.createdAtMs.offset, 'createdAtMs'),
  };
}
