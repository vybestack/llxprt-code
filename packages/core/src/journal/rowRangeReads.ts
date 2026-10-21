/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import { readRowPiece, ROW_PIECE_CRC_BYTES } from './rowPiece.js';
import type { FrameHead } from './frame.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import type { RowEntry } from './rowEntry.js';
import { readRowIds, type StoredRow } from './rowReads.js';
import {
  decodeRowHeader,
  validateRowAgainstBody,
  type RowHeader,
} from './rowRecord.js';

async function rowHead(
  access: RecordAccess,
  entry: RowEntry,
): Promise<{ readonly head: FrameHead; readonly header: RowHeader }> {
  const head = await access.readRecordHead(entry.recordOffset, 'ROW');
  if (head.kind !== RECORD_KIND.ROW)
    throw new JournalFormatError('Block source record is not a row');
  const header = decodeRowHeader(head.kindHeader);
  if (header.label !== entry.label)
    throw new JournalFormatError(
      'Block source row label differs from its entry',
    );
  validateRowAgainstBody(header, head.bodyLen);
  return { head, header };
}

export async function readStoredBlock(
  access: RecordAccess,
  entry: RowEntry,
  index: number,
): Promise<Uint8Array> {
  const { head, header } = await rowHead(access, entry);
  if (!Number.isInteger(index) || index < 0 || index >= header.blocks.length)
    throw new JournalFormatError('Row block is absent');
  const block = header.blocks[index];
  return readRowPiece(access, head, block.offset, block.length);
}

export async function readStoredMetadata(
  access: RecordAccess,
  entry: RowEntry,
): Promise<StoredRow> {
  const { head, header } = await rowHead(access, entry);
  const { rawIds } = await readRowIds(access, entry);
  const meta = await readRowPiece(
    access,
    head,
    header.idsLen + ROW_PIECE_CRC_BYTES,
    header.metaLen,
  );
  return { header, rawIds, meta, blocks: [] };
}
