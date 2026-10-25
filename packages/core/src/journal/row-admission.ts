/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalGroupWriter } from './groupWriter.js';
import { writeSync } from 'node:fs';
import { crc32, putU32, viewOf } from './bytes.js';
import { encodeFrameStart, readFrameStart } from './frame.js';
import { createRecordAccess } from './recordAccess.js';
import { encodeRowDraft, type RowDraft } from './rowDraft.js';
import { decodeRowHeader, encodeIdPiece } from './rowRecord.js';
import { readStoredRow } from './rowReads.js';
import { entryForNewRow } from './rowDraft.js';
import { rowPieceParts } from './rowPiece.js';
import { RECORD_KIND } from './recordKinds.js';
import type { PositionalReader } from './positionalFile.js';

/** Admission rows have label zero, which no published row can have. */
export function writeAdmittedRow(
  fd: number,
  offset: number,
  draft: RowDraft,
): number {
  const encoded = encodeRowDraft(0n, draft);
  const bodyLength = encoded.record.body?.length;
  if (bodyLength === undefined) throw new Error('Admission row has no body');
  let position = offset;
  const write = (bytes: Uint8Array): void => {
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(
        fd,
        bytes,
        written,
        bytes.length - written,
        position,
      );
      if (count === 0)
        throw new Error('Journal admission write made no progress');
      written += count;
      position += count;
    }
  };
  write(
    encodeFrameStart(RECORD_KIND.ROW, encoded.record.kindHeader, bodyLength),
  );
  let crc = 0;
  for (const piece of rowPieceParts([
    encodeIdPiece(draft.ids.map((id) => id.rawId)),
    draft.meta,
    ...draft.blocks.map((block) => block.bytes),
  ])) {
    crc = crc32(piece, crc);
    write(piece);
  }
  const suffix = new Uint8Array(4);
  putU32(viewOf(suffix), 0, 'admission body CRC', crc);
  write(suffix);
  return position;
}

/** Scans only this admission range, never the already committed history. */
export async function* readAdmittedRows(
  reader: PositionalReader,
  start: number,
  end: number,
): AsyncGenerator<RowDraft> {
  const access = createRecordAccess('(journal admission)', reader, {
    selfOffset: 0,
    durableEnd: end,
  });
  for (let offset = start; offset < end; ) {
    const { head } = await readFrameStart(reader, offset, end);
    if (head.kind === RECORD_KIND.ROW) {
      const header = decodeRowHeader(head.kindHeader);
      if (header.label === 0n) {
        const stored = await readStoredRow(
          access,
          entryForNewRow(
            { header, recordLength: head.endOffset - offset },
            offset,
          ),
        );
        yield {
          ...header,
          ids: header.ids.map((id, index) => ({
            ...id,
            rawId: stored.rawIds[index],
          })),
          meta: stored.meta,
          blocks: header.blocks.map((block, index) => ({
            type: block.type,
            bytes: stored.blocks[index],
          })),
        };
      }
    }
    offset = head.endOffset;
  }
}

export class JournalAdmissions {
  private count = 0;
  constructor(
    private readonly writer: JournalGroupWriter,
    private readonly usable: () => boolean,
  ) {}
  get pending(): boolean {
    return this.count > 0;
  }
  admit(draft: RowDraft): { start: number; end: number } {
    if (!this.usable())
      throw new Error('Journal admission requires an open, stationary writer');
    const range = this.writer.admitRow(draft);
    this.count++;
    return range;
  }
  retainReader(): () => void | Promise<void> {
    return this.writer.retainReader();
  }
  release(count: number): void {
    this.count -= count;
  }
  rows(start: number, end: number): AsyncGenerator<RowDraft> {
    return this.writer.admittedRows(start, end);
  }
}
