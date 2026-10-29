/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { chunkValue, hydrateChunkHeader, readChunkBlock } from './chunk-row.js';
import { JournalFormatError } from './errors.js';
import { readRowPiece, ROW_PIECE_CRC_BYTES } from './rowPiece.js';
import type { FrameHead } from './frame.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import type { RowEntry } from './rowEntry.js';
import {
  readRowIds,
  validateRowReference,
  type RowIds,
  type StoredRow,
  type RowReferenceValidator,
} from './rowReads.js';

import {
  decodeRowHeader,
  validateRowAgainstBody,
  type RowHeader,
} from './rowRecord.js';

async function rowHead(
  access: RecordAccess,
  entry: RowEntry,
  validate?: RowReferenceValidator,
): Promise<{ readonly head: FrameHead; readonly header: RowHeader }> {
  const head = await access.readRecordHead(entry.recordOffset, 'ROW');
  if (head.kind !== RECORD_KIND.ROW)
    throw new JournalFormatError(
      `Block source at offset ${entry.recordOffset} is not a row`,
    );
  const header = await hydrateChunkHeader(
    access,
    decodeRowHeader(head.kindHeader),
  );
  await validateRowReference(entry, header, validate);
  validateRowAgainstBody(header, head.bodyLen);
  return {
    head,
    header: { ...header, label: entry.label },
  };
}

export async function readStoredBlock(
  access: RecordAccess,
  entry: RowEntry,
  index: number,
  ids?: RowIds,
  validate?: RowReferenceValidator,
): Promise<Uint8Array> {
  const { head, header } =
    ids?.head === undefined
      ? await rowHead(access, entry, validate)
      : { head: ids.head, header: ids.header };
  if (ids?.head !== undefined)
    await validateRowReference(
      entry,
      decodeRowHeader(head.kindHeader),
      validate,
    );
  if (!Number.isInteger(index) || index < 0 || index >= header.blocks.length)
    throw new JournalFormatError(
      `Row ${entry.label} at offset ${entry.recordOffset}: block ${index} is absent`,
    );
  if (header.chunk !== undefined)
    return readChunkBlock(access, header.chunk, index);
  const block = header.blocks[index];
  return readRowPiece(access, head, block.offset, block.length);
}

export async function readStoredMetadata(
  access: RecordAccess,
  entry: RowEntry,
  known?: RowIds,
  validate?: RowReferenceValidator,
): Promise<StoredRow> {
  const ids = known ?? (await readRowIds(access, entry, validate));
  const { head, header } =
    ids.head === undefined
      ? await rowHead(access, entry, validate)
      : { head: ids.head, header: ids.header };
  if (known?.head !== undefined)
    await validateRowReference(
      entry,
      decodeRowHeader(head.kindHeader),
      validate,
    );
  const { rawIds } = ids;
  if (header.chunk !== undefined)
    return {
      header,
      rawIds,
      meta: await chunkValue(access, header.chunk.metaRef),
      blocks: [],
    };
  const meta = await readRowPiece(
    access,
    head,
    header.idsLen + ROW_PIECE_CRC_BYTES,
    header.metaLen,
  );
  return { header, rawIds, meta, blocks: [] };
}
