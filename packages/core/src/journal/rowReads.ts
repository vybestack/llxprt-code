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

/** The first read of a row: its kind header and id piece in the usual case (design 2.4). */
export const ROW_START_PREFETCH_BYTES = 4096;

/** A row as an index rebuild sees it: the header and the raw id strings, never a block. */
export interface RowIds {
  readonly header: RowHeader;
  /** `rawIds[i]` is the string behind `header.ids[i]`. */
  readonly rawIds: readonly string[];
}

/**
 * Reads the header and id piece of the row an entry points at, in one read
 * for an ordinary row and a second for one whose pieces are larger than the
 * prefetch. The id piece is not under the body CRC here, which is why every
 * string is hashed again and checked against the header's tuple.
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
  if (header.label !== entry.label) {
    throw new JournalFormatError(
      `Row at offset ${entry.recordOffset} has label ${header.label}, its entry says ${entry.label}`,
    );
  }
  const piece = await idPieceOf(access, head, bodyPrefix, header.idsLen);
  const rawIds = decodeIdPiece(piece, header.ids.length);
  rawIds.forEach((rawId, index) => {
    if (!bytesEqual(hashId(rawId), header.ids[index].idHash)) {
      throw new JournalFormatError(
        `Id ${index} of the row at offset ${entry.recordOffset} does not match its hash`,
      );
    }
  });
  return { header, rawIds };
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

async function readBody(
  access: RecordAccess,
  head: Parameters<RecordAccess['readRecordBody']>[0],
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of access.readRecordBody(head, undefined, 'ROW')) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Reads the row an entry points at, with its body under the body CRC. The row
 * is held whole, so this is for a row-sized read (a block relocated next to its
 * call, a test), not for a scan of the history.
 */
export async function readStoredRow(
  access: RecordAccess,
  entry: RowEntry,
): Promise<StoredRow> {
  const head = await access.readRecordHead(entry.recordOffset, 'ROW');
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
  return {
    header,
    rawIds: decodeIdPiece(body.subarray(0, header.idsLen), header.ids.length),
    meta: body.subarray(header.idsLen, header.idsLen + header.metaLen),
    blocks: header.blocks.map((block) =>
      body.subarray(block.offset, block.offset + block.length),
    ),
  };
}
