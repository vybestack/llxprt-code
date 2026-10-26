/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import type { RowEntry } from './rowEntry.js';
import {
  decodeIdPiece,
  decodeRowHeader,
  hashId,
  type RowHeader,
} from './rowRecord.js';
import { bytesEqual } from './bytes.js';
import type { FrameHead } from './frame.js';
import { checkedRowPiece, ROW_PIECE_CRC_BYTES } from './rowPiece.js';
import { validateRowAgainstBody } from './rowRecord.js';

/** The first read of a row: its kind header and id piece in the usual case (design 2.4). */
export const ROW_START_PREFETCH_BYTES = 4096;

/** A row as an index rebuild sees it: the header and the raw id strings, never a block. */
export interface RowIds {
  readonly head?: FrameHead;
  readonly header: RowHeader;
  /** `rawIds[i]` is the string behind `header.ids[i]`. */
  readonly rawIds: readonly string[];
}

/**
 * Reads the header and id piece of the row an entry points at, in one read
 * for an ordinary row and a second for one whose pieces are larger than the
 * prefetch. Its piece CRC is checked before decoding; each string is also
 * hashed and checked against the frame-protected tuple.
 */
export async function readRowIds(
  access: RecordAccess,
  entry: RowEntry,
): Promise<RowIds> {
  const { head, bodyPrefix } = await access.readRecordStart(
    entry.recordOffset,
    'ROW',
    ROW_START_PREFETCH_BYTES,
  );
  if (head.kind !== RECORD_KIND.ROW) {
    throw new JournalFormatError(
      `Record at offset ${entry.recordOffset} is not a row (kind ${head.kind})`,
    );
  }
  const header = decodeRowHeader(head.kindHeader);
  if (entry.transcriptId === 0n && header.label !== entry.label) {
    throw new JournalFormatError(
      `Row at offset ${entry.recordOffset} has label ${header.label}, its entry says ${entry.label}`,
    );
  }
  validateRowAgainstBody(header, head.bodyLen);
  const withCrc = await idPieceOf(
    access,
    head,
    bodyPrefix,
    header.idsLen + ROW_PIECE_CRC_BYTES,
  );
  const piece = checkedRowPiece(access, head, withCrc, 0, header.idsLen);
  const rawIds = decodeIdPiece(piece, header.ids.length);
  rawIds.forEach((rawId, index) => {
    if (!bytesEqual(hashId(rawId), header.ids[index].idHash)) {
      throw new JournalFormatError(
        `Id ${index} of the row at offset ${entry.recordOffset} does not match its hash`,
      );
    }
  });
  return { head, header, rawIds };
}

async function idPieceOf(
  access: RecordAccess,
  head: { readonly offset: number; readonly bodyOffset: number },
  bodyPrefix: Uint8Array,
  idsLen: number,
): Promise<Uint8Array> {
  if (bodyPrefix.length >= idsLen) return bodyPrefix.subarray(0, idsLen);
  const wider = await access.readRecordStart(
    head.offset,
    'ROW',
    head.bodyOffset - head.offset + idsLen,
  );
  if (wider.bodyPrefix.length < idsLen) {
    throw new JournalFormatError(
      `Row at offset ${head.offset} ends inside its id piece`,
    );
  }
  return wider.bodyPrefix.subarray(0, idsLen);
}

/** A whole row as stored: the header, the raw ids, the metadata piece and each block. */
export interface StoredRow {
  readonly header: RowHeader;
  readonly rawIds: readonly string[];
  readonly meta: Uint8Array;
  readonly blocks: readonly Uint8Array[];
}

/** Reads the body into one buffer of its declared length, so a row is never held twice. */
async function readBody(
  access: RecordAccess,
  head: Parameters<RecordAccess['readRecordBody']>[0],
): Promise<Uint8Array> {
  const body = Buffer.allocUnsafe(head.bodyLen);
  let filled = 0;
  for await (const chunk of access.readRecordBody(head, undefined, 'ROW')) {
    if (filled + chunk.length > head.bodyLen) {
      throw new JournalFormatError(
        `Row at offset ${head.offset} has more body bytes than its ${head.bodyLen}`,
      );
    }
    body.set(chunk, filled);
    filled += chunk.length;
  }
  if (filled !== head.bodyLen) {
    throw new JournalFormatError(
      `Row at offset ${head.offset} has ${filled} body bytes, its head says ${head.bodyLen}`,
    );
  }
  return body;
}

/**
 * Reads the row an entry points at, with its body under the body CRC. The row
 * is held whole, so this is for a row-sized read (a block relocated next to its
 * call, a test), not for a scan of the history.
 */
export async function readStoredRow(
  access: RecordAccess,
  entry: RowEntry,
  knownHead?: FrameHead,
): Promise<StoredRow> {
  const head =
    knownHead ?? (await access.readRecordHead(entry.recordOffset, 'ROW'));
  if (head.kind !== RECORD_KIND.ROW) {
    throw new JournalFormatError(
      `Record at offset ${entry.recordOffset} is not a row (kind ${head.kind})`,
    );
  }
  const header = decodeRowHeader(head.kindHeader);
  if (header.label !== entry.label) {
    throw new JournalFormatError(
      `Row at offset ${entry.recordOffset} has label ${header.label}, its entry says ${entry.label}`,
    );
  }
  const body = await readBody(access, head);
  return storedRowFromBody(access, head, header, body);
}

export function storedRowFromBody(
  access: RecordAccess,
  head: FrameHead,
  header: RowHeader,
  body: Uint8Array,
): StoredRow {
  validateRowAgainstBody(header, body.length);
  const piece = (offset: number, length: number): Uint8Array =>
    checkedRowPiece(
      access,
      head,
      body.subarray(offset, offset + length + ROW_PIECE_CRC_BYTES),
      offset,
      length,
    );
  return {
    header,
    rawIds: decodeIdPiece(piece(0, header.idsLen), header.ids.length),
    meta: piece(header.idsLen + ROW_PIECE_CRC_BYTES, header.metaLen),
    blocks: header.blocks.map((block) => piece(block.offset, block.length)),
  };
}
