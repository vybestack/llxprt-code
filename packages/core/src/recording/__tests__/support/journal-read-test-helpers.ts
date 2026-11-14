/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { FRAME_HEAD_BYTES } from '../../../journal/frame.js';
import { JOURNAL_HEADER_BYTES } from '../../../journal/fileHeader.js';
import {
  openJournalReadOnly,
  type JournalReader,
} from '../../../journal/journalReader.js';
import { MUTATION, RECORD_KIND } from '../../../journal/recordKinds.js';
import { readStoredRow } from '../../../journal/rowReads.js';
import {
  iterateRowEntries,
  rowTreeRootOf,
} from '../../../journal/rowTreeReader.js';
import {
  decodeTrailerHeader,
  type TrailerHeader,
} from '../../../journal/trailerRecord.js';
import { decodeStoredRow } from '../../../services/history/journalRowCodec.js';
import type { IContent } from '../../../services/history/IContent.js';

export async function journalRows(path: string): Promise<IContent[]> {
  const reader = await openJournalReadOnly(path);
  try {
    const rows: IContent[] = [];
    const root = rowTreeRootOf(reader.trailer);
    if (root !== undefined) {
      for await (const entry of iterateRowEntries(reader, root)) {
        rows.push(decodeStoredRow(await readStoredRow(reader, entry)));
      }
    }
    return rows;
  } finally {
    await reader.close();
  }
}

async function rowsInGroup(
  reader: JournalReader,
  trailer: TrailerHeader,
  previousRows: number,
): Promise<IContent[]> {
  const root = rowTreeRootOf(trailer);
  if (
    root === undefined ||
    (trailer.mutation !== MUTATION.append &&
      trailer.mutation !== MUTATION.compress &&
      trailer.mutation !== MUTATION.replace)
  )
    return [];
  const from = trailer.mutation === MUTATION.append ? previousRows : 0;
  const rows: IContent[] = [];
  for await (const entry of iterateRowEntries(reader, root, from))
    rows.push(decodeStoredRow(await readStoredRow(reader, entry)));
  return rows;
}

export interface RecordedJournalGroup {
  readonly trailer: TrailerHeader;
  readonly rows: readonly IContent[];
}

export async function journalGroups(
  path: string,
): Promise<RecordedJournalGroup[]> {
  const reader = await openJournalReadOnly(path);
  try {
    const groups: RecordedJournalGroup[] = [];
    let previousRows = 0;
    let offset = JOURNAL_HEADER_BYTES;
    const end = reader.trailer?.durableEnd ?? JOURNAL_HEADER_BYTES;
    while (offset < end) {
      const head = await reader.readRecordHead(
        offset,
        'recorded group',
        FRAME_HEAD_BYTES,
      );
      if (head.kind === RECORD_KIND.TRAILER) {
        const trailer = decodeTrailerHeader(head.kindHeader);
        const rows = await rowsInGroup(reader, trailer, previousRows);
        groups.push({ trailer, rows });
        previousRows = trailer.rootAggregate.rows;
      }
      offset = head.endOffset;
    }
    return groups;
  } finally {
    await reader.close();
  }
}
