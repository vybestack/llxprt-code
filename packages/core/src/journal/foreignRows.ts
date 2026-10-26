/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import { copyForeignChunkRow } from './foreign-chunk-row.js';
import { decodeRowHeader } from './rowRecord.js';
import type { RecordAppender } from './groupAppender.js';
import type { SourceRow } from './groupEdits.js';
import { appendSourceRecord, readSourceHead } from './recordTransfer.js';
import { entryForNewRow } from './rowDraft.js';
import type { RowEntry } from './rowEntry.js';
import { readRowIds, type RowIds } from './rowReads.js';

/**
 * Copies the `ROW` record of a row of another journal into the group, byte
 * for byte, and returns the entry that points at the copy (design 5.2). The
 * record holds no file offsets, so the bytes are valid in any file. The entry
 * takes the owner from the source entry, which is the current one; the owner
 * in the record is the owner at write time. What the normalizer derives from
 * other rows starts at zero, as for any row written by a group. `ids` is the
 * header and id piece when the caller has read them already.
 */
export async function copyForeignRow(
  appender: RecordAppender,
  row: SourceRow,
  ids?: RowIds,
): Promise<RowEntry> {
  const { source, entry } = row;
  const read = ids ?? (await readRowIds(source, entry));
  const head =
    read.head ?? (await readSourceHead(source, entry.recordOffset, 'ROW'));
  const shared = appender.retainsSource?.(source) === true;
  const copy = async (): Promise<{ offset: number; bytes: number }> => {
    if (read.header.chunk === undefined)
      return appendSourceRecord(source, appender, head, 'ROW');
    return {
      offset: await copyForeignChunkRow(
        source,
        appender,
        decodeRowHeader(head.kindHeader),
      ),
      bytes: entry.recordLength,
    };
  };
  const written = shared
    ? { offset: entry.recordOffset, bytes: entry.recordLength }
    : await copy();
  if (written.bytes !== entry.recordLength) {
    throw new JournalFormatError(
      `Row ${entry.label} is ${written.bytes} bytes at offset ${entry.recordOffset}, its entry says ${entry.recordLength}`,
    );
  }
  return entryForNewRow(
    {
      header: { ...read.header, label: entry.label, owner: entry.owner },
      recordLength: written.bytes,
    },
    written.offset,
    shared ? entry.transcriptId : appender.transcriptIdentity?.(written.offset),
  );
}
