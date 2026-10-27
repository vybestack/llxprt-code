/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { chunkValue, hydrateChunkHeader, readChunkBlock } from './chunk-row.js';
import { JournalFormatError } from './errors.js';
import { readRowPiece, ROW_PIECE_CRC_BYTES } from './rowPiece.js';
import type { FrameHead } from './frame.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import type { RowEntry } from './rowEntry.js';
import { readRowIds, type RowIds, type StoredRow } from './rowReads.js';
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
    throw new JournalFormatError(
      `Block source at offset ${entry.recordOffset} is not a row`,
    );
  const header = await hydrateChunkHeader(
    access,
    decodeRowHeader(head.kindHeader),
  );
  if (entry.transcriptId === 0n && header.label !== entry.label)
    throw new JournalFormatError(
      `Row at offset ${entry.recordOffset} has label ${header.label}, its entry says ${entry.label}`,
    );
  validateRowAgainstBody(header, head.bodyLen);
  return {
    head,
    header: { ...header, label: entry.label, owner: entry.owner },
  };
}

export async function readStoredBlock(
  access: RecordAccess,
  entry: RowEntry,
  index: number,
  ids?: RowIds,
): Promise<Uint8Array> {
  const { head, header } =
    ids?.head === undefined
      ? await rowHead(access, entry)
      : { head: ids.head, header: ids.header };
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
): Promise<StoredRow> {
  const ids = known ?? (await readRowIds(access, entry));
  const { head, header } =
    ids.head === undefined
      ? await rowHead(access, entry)
      : { head: ids.head, header: ids.header };
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
